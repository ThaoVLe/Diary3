import React, { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogTitle, DialogHeader } from './ui/dialog';
import { Input } from './ui/input';
import { Loader2, MapPin, Search } from 'lucide-react';

interface Location {
  lat: number;
  lng: number;
  address?: string;
  name?: string;
}

interface LocationSelectorProps {
  onLocationSelect: (location: Location) => void;
  defaultLocation?: Location;
}

export function LocationSelector({ onLocationSelect, defaultLocation }: LocationSelectorProps) {
  const [showMap, setShowMap] = useState(false);
  const [location, setLocation] = useState<Location | null>(defaultLocation || null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<google.maps.places.PlaceResult[]>([]);
  const [mapError, setMapError] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const searchBoxRef = useRef<google.maps.places.SearchBox | null>(null);
  const placesServiceRef = useRef<google.maps.places.PlacesService | null>(null);

  // Function to hide keyboard on mobile devices
  const hideKeyboard = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const temporaryInput = document.createElement('input');
    temporaryInput.setAttribute('type', 'text');
    temporaryInput.style.position = 'absolute';
    temporaryInput.style.opacity = '0';
    temporaryInput.style.height = '0';
    temporaryInput.style.fontSize = '16px';
    document.body.appendChild(temporaryInput);
    temporaryInput.focus();
    temporaryInput.blur();
    document.body.removeChild(temporaryInput);
  };

  // Load Google Maps API
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.google?.maps) {
      const script = document.createElement('script');
      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initMap`;
      script.async = true;
      script.defer = true;
      window.initMap = () => {
        console.log('Google Maps initialized');
        if (showMap && mapRef.current && !mapInstanceRef.current) {
          initMap();
        }
      };
      script.onload = () => console.log('Google Maps script loaded');
      document.head.appendChild(script);
    }
  }, []);

  // Function to initialize the map
  const initMap = () => {
    if (!mapRef.current || !window.google?.maps) {
      setMapError("Google Maps API not loaded yet");
      return;
    }

    if (mapInstanceRef.current) return; // Map already initialized

    try {
      setMapError(null);
      setLoading(true);

    } catch (error) {
      console.error("Error initializing map:", error);
      setMapError("Failed to initialize Google Maps");
      setLoading(false);
    }

      // Default to a central location if none provided
      const initialPosition = { lat: 37.7749, lng: -122.4194 }; // Default to San Francisco

      const mapOptions: google.maps.MapOptions = {
        center: initialPosition,
        zoom: 15,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      };

      const map = new google.maps.Map(mapRef.current, mapOptions);
      mapInstanceRef.current = map;

      // Initialize marker
      markerRef.current = new google.maps.Marker({
        map,
        position: initialPosition,
        draggable: true,
      });

      // Initialize PlacesService
      placesServiceRef.current = new google.maps.places.PlacesService(map);

      // Set up search box
      const input = document.getElementById('map-search-input') as HTMLInputElement;
      if (input && window.google.maps.places) {
        searchBoxRef.current = new google.maps.places.SearchBox(input);
        map.controls[google.maps.ControlPosition.TOP_LEFT].push(input);

        // Bias the SearchBox results towards current map viewport
        map.addListener('bounds_changed', () => {
          if (searchBoxRef.current) {
            searchBoxRef.current.setBounds(map.getBounds() as google.maps.LatLngBounds);
          }
        });

        // Listen for the event fired when the user selects a prediction
        searchBoxRef.current.addListener('places_changed', () => {
          if (!searchBoxRef.current) return;
          const places = searchBoxRef.current.getPlaces();
          if (places && places.length > 0) {
            const place = places[0];
            if (place.geometry && place.geometry.location) {
              map.setCenter(place.geometry.location);
              if (markerRef.current) {
                markerRef.current.setPosition(place.geometry.location);
              }
              handlePlaceSelected(place);
            }
          }
        });
      }

    // Update location on marker drag
    if (markerRef.current) {
      markerRef.current.addListener('dragend', () => {
        if (markerRef.current && markerRef.current.getPosition()) {
          const position = markerRef.current.getPosition() as google.maps.LatLng;

          // Reverse geocode to get address for the new position
          const geocoder = new google.maps.Geocoder();
          geocoder.geocode({ location: position }, (results, status) => {
            if (status === google.maps.GeocoderStatus.OK && results && results[0]) {
              setLocation({
                lat: position.lat(),
                lng: position.lng(),
                address: results[0].formatted_address,
              });
            } else {
              setLocation({
                lat: position.lat(),
                lng: position.lng(),
              });
            }
          });
        }
      });
    }
  };

  // Initialize the map when it becomes visible
  useEffect(() => {
    if (showMap) {
      setTimeout(initMap, 100); // Short delay to ensure DOM is ready
    }
  }, [showMap]);

  const getCurrentPosition = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation is not supported by your browser'));
      } else {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        });
      }
    });
  };

  const updateLocationFromLatLng = async (lat: number, lng: number) => {
    const newLocation: Location = { lat, lng };

    try {
      const geocoder = new google.maps.Geocoder();
      const result = await geocoder.geocode({ location: { lat, lng } });

      if (result.results && result.results.length > 0) {
        const addressComponents = result.results[0];
        newLocation.address = addressComponents.formatted_address;
      }
    } catch (error) {
      console.error('Error geocoding location:', error);
    }

    setLocation(newLocation);
  };

  const updateLocationFromPlace = (place: google.maps.places.PlaceResult) => {
    if (place.geometry?.location) {
      const newLocation: Location = {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng(),
        address: place.formatted_address,
        name: place.name
      };
      setLocation(newLocation);
    }
  };

  const handleSearch = () => {
    if (!searchQuery.trim()) {
      return;
    }

    setLoading(true);

    if (!window.google?.maps || !placesServiceRef.current) {
      console.error("Google Maps Places service is not available");
      setLoading(false);
      return;
    }

    placesServiceRef.current.findPlaceFromQuery({
      query: searchQuery,
      fields: ['name', 'geometry', 'formatted_address', 'place_id']
    }, (results, status) => {
      setLoading(false);

      if (status === google.maps.places.PlacesServiceStatus.OK && results && results.length > 0) {
        const place = results[0];
        const location = place.geometry?.location;

        if (location) {
          mapInstanceRef.current?.setCenter(location);
          mapInstanceRef.current?.setZoom(15);
          markerRef.current?.setPosition(location);

          setLocation({
            lat: location.lat(),
            lng: location.lng(),
            address: place.formatted_address || '',
            name: place.name || ''
          });
        }
      } else {
        console.error("Place search failed with status:", status);
      }
    });
  };

  const handleSelectLocation = () => {
    if (location) {
      onLocationSelect(location);
      setShowMap(false);
    }
  };

  const reverseGeocode = (latLng: google.maps.LatLng) => {
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ location: latLng }, (results, status) => {
      if (status === google.maps.GeocoderStatus.OK && results && results[0]) {
        setLocation({
          lat: latLng.lat(),
          lng: latLng.lng(),
          address: results[0].formatted_address,
        });
      } else {
        setLocation({
          lat: latLng.lat(),
          lng: latLng.lng(),
        });
      }
    });
  };

  // Initialize map
  useEffect(() => {
    if (window.google?.maps && mapRef.current && showMap) {
      setLoading(true);
      try {
        const defaultLatLng = { lat: 40.7128, lng: -74.006 }; // New York
        const mapOptions = {
          center: defaultLatLng,
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        };

        const map = new google.maps.Map(mapRef.current, mapOptions);
        mapInstanceRef.current = map;

        // Initialize marker
        const marker = new google.maps.Marker({
          position: defaultLatLng,
          map,
          draggable: true,
          animation: google.maps.Animation.DROP,
        });
        markerRef.current = marker;

        // Initialize Places service
        if (window.google?.maps?.places) {
          placesServiceRef.current = new google.maps.places.PlacesService(map);
        }

        // Initialize search box
        const searchInput = document.getElementById('map-search-input') as HTMLInputElement;
        if (searchInput && window.google?.maps?.places) {
          const searchBox = new google.maps.places.SearchBox(searchInput);
          searchBoxRef.current = searchBox;

          // Bias the SearchBox results towards current map's viewport
          map.addListener('bounds_changed', () => {
            if (searchBox.getBounds) {
              searchBox.setBounds(map.getBounds()!);
            }
          });

          // Listen for search events
          searchBox.addListener('places_changed', () => {
            const places = searchBox.getPlaces();
            if (!places || places.length === 0) return;

            const place = places[0];
            if (!place.geometry?.location) return;

            // Center map on the selected place
            map.setCenter(place.geometry.location);
            map.setZoom(15);

            // Update marker
            marker.setPosition(place.geometry.location);

            // Update location state
            const newLocation: Location = {
              lat: place.geometry.location.lat(),
              lng: place.geometry.location.lng(),
              address: place.formatted_address,
              name: place.name
            };
            setLocation(newLocation);
          });
        }

        // Handle marker drag end
        marker.addListener('dragend', () => {
          const latLng = marker.getPosition();
          if (latLng) {
            reverseGeocode(latLng);
          }
        });

        // If we have a default location, set it
        if (defaultLocation) {
          const latLng = new google.maps.LatLng(defaultLocation.lat, defaultLocation.lng);
          marker.setPosition(latLng);
          map.setCenter(latLng);
        }
      } catch (error) {
        console.error("Error initializing Google Maps:", error);
      } finally {
        setLoading(false);
      }
    }
  }, [showMap, defaultLocation]);

  const handlePlaceSelected = (place: google.maps.places.PlaceResult) => {
    updateLocationFromPlace(place);
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setShowMap(true);
          hideKeyboard(); // Hide keyboard when opening the map
        }}
        className="flex items-center gap-2"
      >
        <MapPin className="h-4 w-4" />
        {location ? (location.name || location.address || 'Selected location') : 'Select location'}
      </Button>

      <Dialog open={showMap} onOpenChange={setShowMap}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Select Location</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2 mb-4">
            <Input
              id="map-search-input"
              placeholder="Search for a location"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1"
            />
            <Button type="button" onClick={handleSearch} variant="secondary">
              <Search className="h-4 w-4" />
            </Button>
          </div>

          {loading ? (
            <div className="h-[400px] w-full flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin" />
            </div>
          ) : mapError ? (
            <div className="h-[400px] w-full flex flex-col items-center justify-center bg-gray-100 rounded-md border p-4">
              <div className="bg-gray-200 rounded-full p-3 mb-4">
                {/* AlertCircle component is missing, replace with appropriate icon */}
                {/*<AlertCircle className="h-6 w-6 text-gray-500" />*/}
              </div>
              <h3 className="text-lg font-medium mb-2">Oops! Something went wrong.</h3>
              <p className="text-sm text-gray-500 text-center max-w-md">
                {mapError || "This page didn't load Google Maps correctly. See the JavaScript console for technical details."}
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setMapError(null);
                  setTimeout(initMap, 100);
                }}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div
              ref={mapRef}
              className="h-[400px] w-full rounded-md border"
            ></div>
          )}

          <div className="flex justify-end gap-2 mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowMap(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSelectLocation}
              disabled={!location}
            >
              Confirm Location
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}