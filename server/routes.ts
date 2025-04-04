import type { Express } from "express";
import { createServer, type Server } from "http";
import multer from "multer";
import path from "path";
import fs from "fs";
import { storage } from "./storage";
import { insertEntrySchema, insertCommentSchema } from "@shared/schema";
import express from 'express';
import sharp from 'sharp';

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Create cache directory for resized images
const resizedCacheDir = path.join(process.cwd(), "uploads", ".cache");
if (!fs.existsSync(resizedCacheDir)) {
  fs.mkdirSync(resizedCacheDir, { recursive: true });
}

// Update video MIME types support
const validVideoTypes = [
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'video/webm',
  'video/3gpp',
  'video/x-matroska',
  'video/mov'  // Add explicit MOV support
];

// Configure multer for file uploads
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  }),
  limits: { 
    fileSize: 50 * 1024 * 1024 // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const validImageTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/heic',
      'image/heif'
    ];

    const allowedTypes = [...validImageTypes, ...validVideoTypes];

    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error('Invalid file type. Please upload an image or video file.'));
      return;
    }

    cb(null, true);
  }
});

export async function registerRoutes(app: Express): Promise<Server> {
  // Image resizing middleware for optimization
  app.use('/uploads', async (req, res, next) => {
    const filename = path.basename(req.path);
    const filePath = path.join(uploadsDir, filename);
    
    // Skip processing for non-existent files
    if (!fs.existsSync(filePath)) {
      return next();
    }
    
    // Handle query parameters for image resizing
    const width = req.query.w ? parseInt(req.query.w as string) : null;
    const quality = req.query.q ? parseInt(req.query.q as string) : 85;
    const maxSize = req.query.maxSize ? parseInt(req.query.maxSize as string) : null;
    
    // Skip processing for videos and non-image files
    const isVideo = filename.match(/\.(mp4|webm|mov|m4v|3gp|mkv)$/i);
    const isImage = filename.match(/\.(jpe?g|png|gif|webp|heic|heif)$/i);
    
    if (isVideo || !isImage || (!width && !maxSize && quality === 85)) {
      return next();
    }
    
    try {
      // Create a cache key based on the parameters
      const cacheKey = `${path.parse(filename).name}-w${width}-q${quality}-m${maxSize}${path.parse(filename).ext}`;
      const cachePath = path.join(resizedCacheDir, cacheKey);
      
      // Use cached version if it exists
      if (fs.existsSync(cachePath)) {
        return res.sendFile(cachePath);
      }
      
      // Process the image with sharp
      let sharpInstance = sharp(filePath);
      const metadata = await sharpInstance.metadata();
      
      // Resize if width is specified
      if (width) {
        sharpInstance = sharpInstance.resize(width);
      }
      
      // Set output format based on original (use webp for jpg/jpeg for better compression)
      let outputOptions: any = {};
      let outputFormat: string;
      
      if (metadata.format === 'jpeg' || metadata.format === 'jpg') {
        outputFormat = 'jpeg';
        outputOptions = { quality };
      } else if (metadata.format === 'png') {
        outputFormat = 'png';
        outputOptions = { quality };
      } else if (metadata.format === 'webp') {
        outputFormat = 'webp';
        outputOptions = { quality };
      } else {
        outputFormat = 'jpeg';
        outputOptions = { quality };
      }
      
      // Process and save to cache
      const resizedImgBuffer = await sharpInstance
        .toFormat(outputFormat as keyof sharp.FormatEnum, outputOptions)
        .toBuffer();
      
      // Check if maxSize constraint is met
      if (maxSize && resizedImgBuffer.length > maxSize * 1024) {
        // Recalculate quality to meet size constraint
        let adjustedQuality = quality;
        let attempts = 0;
        let finalBuffer = resizedImgBuffer;
        
        while (finalBuffer.length > maxSize * 1024 && adjustedQuality > 10 && attempts < 5) {
          adjustedQuality = Math.max(10, adjustedQuality - 15);
          finalBuffer = await sharpInstance
            .toFormat(outputFormat as keyof sharp.FormatEnum, { quality: adjustedQuality })
            .toBuffer();
          attempts++;
        }
        
        // Save to cache and return
        fs.writeFileSync(cachePath, finalBuffer);
        res.type(`image/${outputFormat === 'jpeg' ? 'jpeg' : outputFormat}`);
        return res.send(finalBuffer);
      }
      
      // Save to cache and return
      fs.writeFileSync(cachePath, resizedImgBuffer);
      res.type(`image/${outputFormat === 'jpeg' ? 'jpeg' : outputFormat}`);
      return res.send(resizedImgBuffer);
    } catch (error) {
      console.error('Image processing error:', error);
      next(); // Continue to static middleware if processing fails
    }
  });
  
  // Fallback to serve original files
  app.use('/uploads', express.static(uploadsDir));

  app.get("/api/entries", async (req, res) => {
    try {
      const entries = await storage.getAllEntries();
      res.json(entries);
    } catch (error) {
      console.error("Error fetching entries:", error);
      res.status(500).json({ message: "Failed to fetch entries" });
    }
  });

  app.get("/api/entries/:id", async (req, res) => {
    try {
      const entry = await storage.getEntry(parseInt(req.params.id));
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      res.json(entry);
    } catch (error) {
      console.error("Error fetching entry:", error);
      res.status(500).json({ message: "Failed to fetch entry" });
    }
  });

  app.post("/api/entries", async (req, res) => {
    try {
      const result = insertEntrySchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid entry data", 
          errors: result.error.errors 
        });
      }
      const entry = await storage.createEntry(result.data);
      res.status(201).json(entry);
    } catch (error) {
      console.error("Error creating entry:", error);
      res.status(500).json({ message: "Failed to create entry" });
    }
  });

  app.put("/api/entries/:id", async (req, res) => {
    try {
      const result = insertEntrySchema.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid entry data", 
          errors: result.error.errors 
        });
      }
      const entry = await storage.updateEntry(parseInt(req.params.id), result.data);
      if (!entry) return res.status(404).json({ message: "Entry not found" });
      res.json(entry);
    } catch (error) {
      console.error("Error updating entry:", error);
      res.status(500).json({ message: "Failed to update entry" });
    }
  });

  app.delete("/api/entries/:id", async (req, res) => {
    try {
      const success = await storage.deleteEntry(parseInt(req.params.id));
      if (!success) return res.status(404).json({ message: "Entry not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting entry:", error);
      res.status(500).json({ message: "Failed to delete entry" });
    }
  });

  // Media upload endpoint with error handling
  app.post("/api/upload", (req, res) => {
    upload.single("file")(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ message: "File is too large. Maximum size is 50MB" });
        }
        return res.status(400).json({ message: "Error uploading file" });
      } else if (err) {
        if (err.message === 'Invalid file type') {
          return res.status(400).json({ message: "Invalid file type. Please upload an image or video file." });
        }
        return res.status(500).json({ message: "Server error while uploading file" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const fileUrl = `/uploads/${req.file.filename}`;
      res.json({ url: fileUrl });
    });
  });

  // Comment routes
  app.get("/api/entries/:id/comments", async (req, res) => {
    try {
      const comments = await storage.getComments(parseInt(req.params.id));
      res.json(comments);
    } catch (error) {
      console.error("Error fetching comments:", error);
      res.status(500).json({ message: "Failed to fetch comments" });
    }
  });

  app.post("/api/entries/:id/comments", async (req, res) => {
    try {
      const result = insertCommentSchema.safeParse({
        entryId: parseInt(req.params.id),
        content: req.body.content
      });

      if (!result.success) {
        return res.status(400).json({ 
          message: "Invalid comment data", 
          errors: result.error.errors 
        });
      }

      const comment = await storage.addComment(result.data);
      res.status(201).json(comment);
    } catch (error) {
      console.error("Error creating comment:", error);
      res.status(500).json({ message: "Failed to create comment" });
    }
  });

  app.delete("/api/entries/:id/comments/:commentId", async (req, res) => {
    try {
      const success = await storage.deleteComment(parseInt(req.params.commentId));
      if (!success) return res.status(404).json({ message: "Comment not found" });
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting comment:", error);
      res.status(500).json({ message: "Failed to delete comment" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}