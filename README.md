# MOUNTAINS (Mountain Explorer)

App web tipo PWA para localizar picos/montanas cerca de una ubicacion, verlos en un mapa y abrir una pagina de detalle por cada montaña.

## Características
- Mapa interactivo con Leaflet + OpenStreetMap.
- Selección de ubicación: click en el mapa, “My Location” (Geolocation API) y “Search Location” (Nominatim).
- Búsqueda de montañas cercanas con Overpass (OSM) para `natural=peak` y `natural=volcano`.
- Listado de resultados con acciones: “En mapa” centra y abre el popup, “Ver detalles” abre `mountain.html` con la montaña seleccionada.
- Página de detalle `mountain.html`: cabecera con ubicación, nombre y stats (altitud, ubicación, coords).
- Street View 360: visor 360 interactivo (StreetViewPanorama) si hay cobertura y tienes la API key, miniaturas (0/90/180/270) como atajos/fallback.
- Enlaces a Wikiloc: búsquedas por mapa alrededor del pico.
- Estado persistente al volver del detalle: la búsqueda anterior se guarda en `sessionStorage` y se restaura al volver al mapa.
- Iconos PWA + favicons generados y guardados en `public/images/`.

## Estructura
- `index.html`: página principal (mapa + resultados).
- `script.js`: lógica del mapa/búsqueda (Leaflet, Nominatim, Overpass, navegación a detalle, persistencia).
- `styles.css`: estilo del mapa/listado (alineado con el look de Stitch).
- `mountain.html`: plantilla de detalle (basada en Stitch).
- `mountain-details.js`: lógica de detalle (Street View 360, ubicación reverse geocoding, links a Wikiloc, compartir/copiar).
- `manifest.json`: configuración PWA + iconos.
- `public/images/`: favicons y assets.
- `public/images/icons/`: iconos PWA por tamaño.

## Ejecutar en local
Necesitas un servidor (no abrir con `file://`) porque el navegador bloquea/limita `fetch` y la instalación PWA fuera de `http(s)`.

Opciones:
1. VS Code: extensión “Live Server” sobre `index.html`.
2. Python:
```powershell
py -m http.server 5173
```
Luego abre `http://localhost:5173/index.html`.

## Google Street View (API key)
La key se carga desde `config.js` (archivo local, no debe commitearse).

1. Crea `config.js` desde `config.example.js`:
```js
window.GOOGLE_MAPS_API_KEY = "TU_KEY";
```
2. En Google Cloud habilita: `Maps JavaScript API` (visor 360 interactivo) y `Street View Static API` (metadata + imágenes estáticas).
3. Restringe la key por HTTP referrer (dominio/localhost) porque se expone en el frontend.

Nota:
- Si el pico es remoto, puede salir `ZERO_RESULTS` (no hay cobertura Street View cerca).
- Si ves `REQUEST_DENIED`, revisa APIs habilitadas, billing y restricciones de la key.

## Notas técnicas
- Overpass puede fallar por rate limit o caídas temporales. El código rota entre varios endpoints y muestra el motivo en el error.
- `config.js` está en `.gitignore`. Si ya lo llegaste a commitear, elimínalo del índice y rota la key:
```powershell
git rm --cached config.js
```
