// Aplicación para encontrar montañas cercanas con mapa interactivo
// Utiliza APIs gratuitas: Geolocation API + Nominatim + Overpass API + Leaflet Maps

class MountainFinderWithMap {
    constructor() {
        // Elementos del DOM que vamos a manipular
        this.myLocationBtn = document.getElementById('myLocationBtn');
        this.searchLocationBtn = document.getElementById('searchLocationBtn');
        this.locationSearch = document.getElementById('locationSearch');
        this.locationInput = document.getElementById('locationInput');
        this.searchPlaceBtn = document.getElementById('searchPlaceBtn');
        this.status = document.getElementById('status');
        this.locationInfo = document.getElementById('locationInfo');
        this.mountainsContainer = document.getElementById('mountainsContainer');
        this.mountainsList = document.getElementById('mountainsList');
        this.errorMessage = document.getElementById('errorMessage');
        this.coordinates = document.getElementById('coordinates');
        this.address = document.getElementById('address');
        
        // Variables del mapa
        this.map = null;
        this.userMarker = null;
        this.mountainMarkers = [];
        this.currentLocation = null;
        this.lastMountains = [];
        
        // Configuración de la búsqueda
        this.searchRadius = 50000; // Radio de búsqueda en metros (50km)
        this.maxResults = 30; // Máximo número de montañas a mostrar

        // Overpass endpoints are often rate-limited or temporarily down; we rotate on failure.
        this.overpassEndpoints = [
            'https://overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter',
            'https://overpass.nchc.org.tw/api/interpreter'
        ];
        
        // Inicializar la aplicación
        this.init();
    }

    // Inicialización: configurar mapa y event listeners
    init() {
        // Inicializar el mapa
        this.initMap();
        
        // Configurar event listeners
        this.myLocationBtn.addEventListener('click', () => this.useMyLocation());
        this.searchLocationBtn.addEventListener('click', () => this.toggleLocationSearch());
        this.searchPlaceBtn.addEventListener('click', () => this.searchPlace());
        this.locationInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.searchPlace();
        });
        
        // Verificar si el navegador soporta geolocalización
        if (!navigator.geolocation) {
            this.showError('Your browser does not support geolocation');
        }

        // Restore previous search (if any) so Back from details doesn't reset the app.
        if (!this.restoreSearchState()) {
            // Mostrar mensaje inicial
            this.showLocationInfo('Click on the map to select a location', 'Or use the buttons to search for a specific place');
        }
    }

    // Inicializar el mapa con Leaflet
    initMap() {
        // Crear el mapa centrado en España por defecto
        this.map = L.map('map').setView([40.4168, -3.7038], 6);
        
        // Agregar capa de OpenStreetMap
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 18
        }).addTo(this.map);
        
        // Configurar evento de clic en el mapa
        this.map.on('click', (e) => {
            this.selectLocation(e.latlng.lat, e.latlng.lng);
        });
    }

    persistSearchState() {
        try {
            const state = {
                v: 1,
                ts: Date.now(),
                currentLocation: this.currentLocation,
                mapView: this.map ? { center: this.map.getCenter(), zoom: this.map.getZoom() } : null,
                mountains: this.lastMountains || [],
                ui: {
                    locationSearchHidden: this.locationSearch.classList.contains('hidden'),
                    addressText: this.address?.textContent || '',
                    coordinatesText: this.coordinates?.textContent || ''
                }
            };
            sessionStorage.setItem('mountainExplorer:state', JSON.stringify(state));
        } catch {
            // ignore storage failures
        }
    }

    restoreSearchState() {
        let raw = null;
        try {
            raw = sessionStorage.getItem('mountainExplorer:state');
        } catch {
            raw = null;
        }
        if (!raw) return false;

        let state = null;
        try {
            state = JSON.parse(raw);
        } catch {
            return false;
        }
        if (!state || state.v !== 1) return false;

        // Don't restore very old sessions (avoids weird stale UI).
        const maxAgeMs = 2 * 60 * 60 * 1000; // 2h
        if (typeof state.ts === 'number' && Date.now() - state.ts > maxAgeMs) return false;

        const loc = state.currentLocation;
        if (!loc || typeof loc.lat !== 'number' || typeof loc.lon !== 'number') return false;

        this.currentLocation = { lat: loc.lat, lon: loc.lon };
        this.lastMountains = Array.isArray(state.mountains) ? state.mountains : [];

        // Restore UI bits
        if (state.ui && typeof state.ui.locationSearchHidden === 'boolean') {
            this.locationSearch.classList.toggle('hidden', state.ui.locationSearchHidden);
        }
        if (state.ui?.coordinatesText) this.coordinates.textContent = state.ui.coordinatesText;
        else this.coordinates.textContent = `${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)}`;
        if (state.ui?.addressText) this.address.textContent = state.ui.addressText;

        this.locationInfo.classList.remove('hidden');

        // Restore marker + map view + results
        this.updateLocationMarker(loc.lat, loc.lon, false);
        if (state.mapView?.center && typeof state.mapView.zoom === 'number') {
            this.map.setView([state.mapView.center.lat, state.mapView.center.lng], state.mapView.zoom);
        } else {
            this.map.setView([loc.lat, loc.lon], 10);
        }

        if (this.lastMountains.length > 0) {
            this.displayMountainsOnMap(this.lastMountains);
            this.displayMountainsList(this.lastMountains);
            this.status.classList.add('hidden');
            this.errorMessage.classList.add('hidden');
        }

        return true;
    }

    // Alternar visibilidad del buscador de ubicaciones
    toggleLocationSearch() {
        this.locationSearch.classList.toggle('hidden');
        if (!this.locationSearch.classList.contains('hidden')) {
            this.locationInput.focus();
        }
        this.persistSearchState();
    }

    // Usar ubicación actual del usuario
    async useMyLocation() {
        try {
            this.showStatus('Getting your location...');
            this.myLocationBtn.disabled = true;
            this.myLocationBtn.classList.add('loading');
            
            const position = await this.getCurrentPosition();
            const { latitude, longitude } = position.coords;
            
            // Seleccionar esta ubicación
            await this.selectLocation(latitude, longitude, true);
            
        } catch (error) {
            console.error('Error:', error);
            this.showError(error.message || 'Error getting your location');
        } finally {
            this.myLocationBtn.disabled = false;
            this.myLocationBtn.classList.remove('loading');
        }
    }

    // Buscar un lugar específico
    async searchPlace() {
        const query = this.locationInput.value.trim();
        if (!query) {
            this.showError('Please enter a location to search');
            return;
        }

        try {
            this.showStatus('Searching location...');
            this.searchPlaceBtn.disabled = true;
            
            // Buscar lugar usando Nominatim
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`,
                {
                    headers: {
                        'User-Agent': 'MountainExplorer/1.0'
                    }
                }
            );
            
            if (!response.ok) {
                throw new Error('Error searching for location');
            }
            
            const data = await response.json();
            
            if (data.length === 0) {
                throw new Error('Location not found. Try a different name.');
            }
            
            const place = data[0];
            const lat = parseFloat(place.lat);
            const lon = parseFloat(place.lon);
            
            // Seleccionar esta ubicación
            await this.selectLocation(lat, lon);
            
            // Ocultar buscador
            this.locationSearch.classList.add('hidden');
            this.locationInput.value = '';
            
        } catch (error) {
            console.error('Error:', error);
            this.showError(error.message || 'Error searching for location');
        } finally {
            this.searchPlaceBtn.disabled = false;
        }
    }

    // Seleccionar una ubicación específica
    async selectLocation(lat, lon, isUserLocation = false) {
        try {
            this.currentLocation = { lat, lon };
            
            // Actualizar marcador en el mapa
            this.updateLocationMarker(lat, lon, isUserLocation);
            
            // Centrar mapa en la ubicación
            this.map.setView([lat, lon], 10);
            
            // Mostrar información de ubicación
            this.showLocationInfo(`${lat.toFixed(6)}, ${lon.toFixed(6)}`, 'Getting location information...');
            
            // Obtener dirección legible
            await this.getAddressFromCoordinates(lat, lon);
            
            // Buscar montañas cercanas
            this.showStatus('Searching for nearby mountains...');
            const mountains = await this.searchNearbyMountains(lat, lon);
            this.lastMountains = mountains;
            
            // Mostrar montañas en el mapa y en la lista
            this.displayMountainsOnMap(mountains);
            this.displayMountainsList(mountains);
            
            // Mostrar resultado
            if (mountains.length > 0) {
                this.showStatus(`Found ${mountains.length} nearby mountains!`);
            } else {
                this.showStatus('No mountains found in the nearby area');
            }

            this.persistSearchState();
            
        } catch (error) {
            console.error('Error:', error);
            this.showError(error.message || 'Error processing location');
        }
    }

    // Actualizar marcador de ubicación en el mapa
    updateLocationMarker(lat, lon, isUserLocation = false) {
        // Remover marcador anterior si existe
        if (this.userMarker) {
            this.map.removeLayer(this.userMarker);
        }
        
        // Crear nuevo marcador con diseño profesional
        const color = isUserLocation ? '#3b82f6' : '#ef4444';
        const iconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
            <circle cx="12" cy="10" r="3"></circle>
        </svg>`;
        
        this.userMarker = L.marker([lat, lon], {
            icon: L.divIcon({
                html: `<div style="background: ${color}; border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border: 3px solid white; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">${iconSvg}</div>`,
                className: 'custom-location-marker',
                iconSize: [32, 32],
                iconAnchor: [16, 16]
            })
        }).addTo(this.map);
        
        // Agregar popup al marcador
        const popupText = isUserLocation ? 'Your current location' : 'Selected location';
        this.userMarker.bindPopup(popupText);
    }

    // Obtener posición actual del usuario usando Geolocation API
    getCurrentPosition() {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                resolve,
                (error) => {
                    let message = 'Error getting location';
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            message = 'Location permission denied. Please allow access to your location.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            message = 'Location information unavailable';
                            break;
                        case error.TIMEOUT:
                            message = 'Location request timed out';
                            break;
                    }
                    reject(new Error(message));
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 300000 // 5 minutos
                }
            );
        });
    }

    // Obtener dirección legible usando Nominatim API (reverse geocoding)
    async getAddressFromCoordinates(lat, lon) {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,
                {
                    headers: {
                        'User-Agent': 'MountainExplorer/1.0'
                    }
                }
            );
            
            if (!response.ok) {
                throw new Error('Error getting location information');
            }
            
            const data = await response.json();
            
            // Construir dirección legible
            const address = this.formatAddress(data.address);
            this.address.textContent = address;
            this.persistSearchState();
            
        } catch (error) {
            console.error('Error getting address:', error);
            this.address.textContent = 'Address not available';
        }
    }

    // Formatear dirección de forma legible
    formatAddress(addressData) {
        if (!addressData) return 'Address not available';
        
        const parts = [];
        
        // Agregar ciudad/pueblo
        if (addressData.city) parts.push(addressData.city);
        else if (addressData.town) parts.push(addressData.town);
        else if (addressData.village) parts.push(addressData.village);
        
        // Agregar estado/provincia
        if (addressData.state) parts.push(addressData.state);
        
        // Agregar país
        if (addressData.country) parts.push(addressData.country);
        
        return parts.join(', ') || 'Address not available';
    }

    // Buscar montañas cercanas usando Overpass API (OpenStreetMap)
    async searchNearbyMountains(lat, lon) {
        try {
            // Query de Overpass para buscar picos y montañas
            const query = `
                [out:json][timeout:25];
                (
                    node["natural"="peak"](around:${this.searchRadius},${lat},${lon});
                    node["natural"="volcano"](around:${this.searchRadius},${lat},${lon});
                );
                out geom;
            `;

            const data = await this.fetchOverpassJson(query);
            
            // Procesar y filtrar resultados
            const mountains = this.processMountainData(data.elements, lat, lon);
            
            // Ordenar por distancia (más cercanas primero)
            mountains.sort((a, b) => a.distance - b.distance);
            
            // Limitar número de resultados
            return mountains.slice(0, this.maxResults);
            
        } catch (error) {
            console.error('Error searching mountains:', error);
            // Surface a more actionable message to the user.
            const msg = (error && error.message) ? error.message : 'Unknown error';
            throw new Error(`Error searching mountain database: ${msg}`);
        }
    }

    async fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...options, signal: controller.signal });
        } finally {
            clearTimeout(t);
        }
    }

    async fetchOverpassJson(query) {
        const body = `data=${encodeURIComponent(query)}`;
        let lastErr = null;

        for (const endpoint of this.overpassEndpoints) {
            try {
                const response = await this.fetchWithTimeout(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body
                }, 30000);

                if (!response.ok) {
                    // Overpass frequently returns 429/504 when busy.
                    const status = response.status;
                    const hint =
                        status === 429 ? 'Rate limited (429). Try again in a minute.' :
                        status === 504 ? 'Gateway timeout (504). Server is busy.' :
                        status === 400 ? 'Bad request (400).' :
                        `HTTP ${status}.`;
                    throw new Error(`Overpass failed at ${endpoint} (${hint})`);
                }

                const data = await response.json();
                if (!data || !Array.isArray(data.elements)) {
                    throw new Error(`Overpass returned unexpected response at ${endpoint}`);
                }
                return data;
            } catch (err) {
                lastErr = err;
                // Try next endpoint
            }
        }

        const msg = lastErr?.message || 'Overpass request failed.';
        throw new Error(msg);
    }

    // Procesar datos de montañas obtenidos de la API
    processMountainData(elements, userLat, userLon) {
        const mountains = [];
        
        elements.forEach(element => {
            // Verificar que tenga las coordenadas necesarias
            if (!element.lat || !element.lon) return;
            
            // Extraer información de la montaña
            const mountain = {
                id: element.id,
                name: element.tags?.name || 'Unnamed Peak',
                lat: element.lat,
                lon: element.lon,
                elevation: element.tags?.ele ? parseInt(element.tags.ele) : null,
                type: element.tags?.natural || 'peak',
                distance: this.calculateDistance(userLat, userLon, element.lat, element.lon),
                // Optional enrichment for the details page
                wikipedia: element.tags?.wikipedia || null,
                wikidata: element.tags?.wikidata || null
            };
            
            // Solo incluir montañas con nombre o elevación conocida
            if (mountain.name !== 'Unnamed Peak' || mountain.elevation) {
                mountains.push(mountain);
            }
        });
        
        return mountains;
    }

    // Mostrar montañas en el mapa
    displayMountainsOnMap(mountains) {
        this.lastMountains = mountains;
        // Limpiar marcadores anteriores
        this.mountainMarkers.forEach(marker => {
            this.map.removeLayer(marker);
        });
        this.mountainMarkers = [];
        
        // Agregar marcadores para cada montaña
        mountains.forEach(mountain => {
            const isVolcano = mountain.type === 'volcano';
            const color = isVolcano ? '#dc2626' : '#059669';
            const iconSvg = isVolcano ? 
                `<svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                    <path d="M2 17l10 5 10-5"></path>
                    <path d="M2 12l10 5 10-5"></path>
                </svg>` :
                `<svg width="14" height="14" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="2">
                    <path d="m8 3 4 8 5-5 5 15H2L8 3z"></path>
                </svg>`;
            
            const marker = L.marker([mountain.lat, mountain.lon], {
                icon: L.divIcon({
                    html: `<div style="background: ${color}; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">${iconSvg}</div>`,
                    className: 'custom-mountain-marker',
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                })
            }).addTo(this.map);
            
            // Crear popup con información de la montaña
            const typeLabel = isVolcano ? 'Volcano' : 'Peak';
            const popupContent = `
                <div class="mountain-popup">
                    <h4>${mountain.name}</h4>
                    <p><strong>Type:</strong> ${typeLabel}</p>
                    ${mountain.elevation ? `<p><strong>Elevation:</strong> <span class="elevation">${mountain.elevation.toLocaleString()} m</span></p>` : ''}
                    <p><strong>Distance:</strong> ${mountain.distance} km</p>
                    <p><strong>Coordinates:</strong> ${mountain.lat.toFixed(4)}, ${mountain.lon.toFixed(4)}</p>
                    <p style="margin-top: 8px;">
                        <a href="mountain.html?id=${encodeURIComponent(mountain.id)}&name=${encodeURIComponent(mountain.name)}&lat=${encodeURIComponent(mountain.lat)}&lon=${encodeURIComponent(mountain.lon)}&ele=${encodeURIComponent(mountain.elevation ?? '')}&type=${encodeURIComponent(mountain.type)}">
                            View details
                        </a>
                    </p>
                </div>
            `;
            
            marker.bindPopup(popupContent);
            this.mountainMarkers.push(marker);
        });
        
        // Ajustar vista del mapa para mostrar todas las montañas
        if (mountains.length > 0 && this.currentLocation) {
            const group = new L.featureGroup([
                this.userMarker,
                ...this.mountainMarkers
            ]);
            this.map.fitBounds(group.getBounds().pad(0.1));
        }
    }

    // Mostrar lista de montañas
    displayMountainsList(mountains) {
        this.lastMountains = mountains;
        this.mountainsList.innerHTML = '';
        
        if (mountains.length === 0) {
            this.mountainsContainer.classList.add('hidden');
            return;
        }
        
        mountains.forEach(mountain => {
            const mountainCard = this.createMountainCard(mountain);
            this.mountainsList.appendChild(mountainCard);
        });
        
        this.mountainsContainer.classList.remove('hidden');
    }

    // Crear tarjeta HTML para una montaña
    createMountainCard(mountain) {
        const card = document.createElement('div');
        card.className = 'mountain-card';
        
        // Determinar tipo e icono
        const isVolcano = mountain.type === 'volcano';
        const typeLabel = isVolcano ? 'Volcano' : 'Peak';
        const iconSvg = isVolcano ? 
            `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
                <path d="M2 17l10 5 10-5"></path>
                <path d="M2 12l10 5 10-5"></path>
            </svg>` :
            `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2">
                <path d="m8 3 4 8 5-5 5 15H2L8 3z"></path>
            </svg>`;
        
        card.innerHTML = `
            <div class="mountain-name">
                ${iconSvg} ${mountain.name}
            </div>
            <div class="mountain-details">
                <div class="detail-item">
                    <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                    </svg>
                    <span><strong>Type:</strong> ${typeLabel}</span>
                </div>
                ${mountain.elevation ? `
                    <div class="detail-item">
                        <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"></polyline>
                        </svg>
                        <span><strong>Elevation:</strong> <span class="elevation">${mountain.elevation.toLocaleString()} m</span></span>
                    </div>
                ` : ''}
                <div class="detail-item">
                    <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                        <circle cx="12" cy="10" r="3"></circle>
                    </svg>
                    <span><strong>Distance:</strong> <span class="distance">${mountain.distance} km</span></span>
                </div>
                <div class="detail-item">
                    <svg class="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12,6 12,12 16,14"></polyline>
                    </svg>
                    <span><strong>Coordinates:</strong> ${mountain.lat.toFixed(4)}, ${mountain.lon.toFixed(4)}</span>
                </div>
            </div>
            <div class="mountain-actions">
                <button type="button" class="detail-btn" data-action="details">Ver detalles</button>
                <button type="button" class="detail-btn detail-btn--secondary" data-action="focus">En mapa</button>
            </div>
        `;
        
        // Event delegation for actions (details vs map focus).
        card.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-action]');
            const action = btn?.getAttribute('data-action');
            if (action === 'details') {
                e.preventDefault();
                this.openMountainDetails(mountain);
                return;
            }
            if (action === 'focus') {
                e.preventDefault();
                this.focusMountainOnMap(mountain);
                return;
            }
            // Default: focus on map (keeps old behavior).
            this.focusMountainOnMap(mountain);
        });
        
        return card;
    }

    focusMountainOnMap(mountain) {
        this.map.setView([mountain.lat, mountain.lon], 14);
        const marker = this.mountainMarkers.find(m =>
            Math.abs(m.getLatLng().lat - mountain.lat) < 0.0001 &&
            Math.abs(m.getLatLng().lng - mountain.lon) < 0.0001
        );
        if (marker) marker.openPopup();
    }

    openMountainDetails(mountain) {
        // Persist the whole search state so Back keeps the same results.
        this.persistSearchState();

        // Store richer data for the details page (query params are kept minimal).
        try {
            sessionStorage.setItem(`mountain:${mountain.id}`, JSON.stringify(mountain));
        } catch {
            // ignore storage failures
        }

        const params = new URLSearchParams();
        params.set('id', String(mountain.id));
        params.set('name', mountain.name);
        params.set('lat', String(mountain.lat));
        params.set('lon', String(mountain.lon));
        if (mountain.elevation !== null && mountain.elevation !== undefined) params.set('ele', String(mountain.elevation));
        params.set('type', mountain.type);

        window.location.href = `mountain.html?${params.toString()}`;
    }

    // Calcular distancia entre dos puntos usando fórmula de Haversine
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radio de la Tierra en kilómetros
        const dLat = this.toRadians(lat2 - lat1);
        const dLon = this.toRadians(lon2 - lon1);
        
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;
        
        return Math.round(distance * 100) / 100; // Redondear a 2 decimales
    }

    // Convertir grados a radianes
    toRadians(degrees) {
        return degrees * (Math.PI / 180);
    }

    // Mostrar información de ubicación
    showLocationInfo(coordinates, address) {
        this.coordinates.textContent = coordinates;
        this.address.textContent = address;
        this.locationInfo.classList.remove('hidden');
    }

    // Mostrar mensaje de estado
    showStatus(message) {
        this.status.textContent = message;
        this.status.classList.remove('hidden');
        this.errorMessage.classList.add('hidden');
    }

    // Mostrar mensaje de error
    showError(message) {
        this.errorMessage.textContent = message;
        this.errorMessage.classList.remove('hidden');
        this.status.classList.add('hidden');
    }
}

// Inicializar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    new MountainFinderWithMap();
});

// Manejar errores globales
window.addEventListener('error', (event) => {
    console.error('Error global:', event.error);
});

// Manejar errores de promesas no capturadas
window.addEventListener('unhandledrejection', (event) => {
    console.error('Promise rejection no manejada:', event.reason);
    event.preventDefault();
});
