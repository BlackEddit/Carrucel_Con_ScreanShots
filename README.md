# Carrusel de Dashboards con Capturas Automáticas

## Explicación del flujo

1. **server.js**: Arranca el servidor Express y configura Puppeteer para tomar capturas de las URLs en `TARGETS`.
2. **Puppeteer**: Abre cada URL, espera 40 segundos y toma una captura. Guarda cada imagen en `public/shots/{id}.png`.
3. **Express**: Sirve la carpeta `public/` y expone el endpoint `/api/list` con la lista de imágenes disponibles.
4. **index.html**: Pide la lista de imágenes a `/api/list` y muestra el carrusel en el navegador.
5. **Carrusel**: Rota automáticamente las imágenes capturadas.

## ¿Por qué rutas relativas?
- Permiten que el código funcione sin importar desde dónde lo ejecutes.
- Así puedes guardar y leer archivos en carpetas del proyecto sin problemas de path.

## ¿Se puede hacer en Python?
Sí, se puede hacer algo similar usando Flask (para el servidor) y Selenium o Playwright (para las capturas). Pero Puppeteer es más directo para manejar Chrome/Chromium en Node.js.

---
