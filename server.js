// Importa dependencias principales

import express from 'express'; // Framework para servidor web
import fs from 'fs'; // Manejo de archivos
import path from 'path'; // Manejo de rutas
import { fileURLToPath } from 'url'; // Utilidad para rutas en ES Modules
import puppeteer from 'puppeteer-core'; // Navegador automatizado para capturas
import chromium from '@sparticuz/chromium'; // Chromium optimizado para serverless
import dotenv from 'dotenv'; // Para leer variables de entorno
dotenv.config();


// Obtiene la ruta actual del archivo y su carpeta
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1) Configura aquí tus URLs (orden = orden del carrusel) desde variables de entorno
// Usa DASHBOARD_URLS en .env, separadas por ";;;"
// Para depuración, puedes dejar los logs de arranque y TARGETS, pero comenta los logs internos si no quieres ruido en producción.
//console.log('[DEBUG] DASHBOARD_URLS raw:', process.env.DASHBOARD_URLS);
const raw = process.env.DASHBOARD_URLS || '';
const clean = raw.replace(/^"(.*)"$/, '$1'); // quita comillas , habia un pedo de que las URLs no se estaban procesando bien
const TARGETS = clean.split(';;;').map((url, i) => ({ id: `dashboard${i+1}`, url: url.trim() })).filter(t => t.url);
// console.log('[DEBUG] TARGETS array:', TARGETS);

// 2) Intervalo de refresco de capturas (minutos)
// Cada cuánto tiempo se actualizan las capturas
const CAPTURE_EVERY_MIN = 5;

// 3) Viewport de las capturas
// Tamaño de la ventana del navegador para la captura
const VIEWPORT = { width: 3200, height: 1800, deviceScaleFactor: 1 };

// 4) Timeout de carga por página (ms)
// Tiempo máximo para que Puppeteer navegue a la página
const PAGE_TIMEOUT_MS = 60_000;

// 5) Opcional: headers/cookies de sesión (solo si tu seguridad lo permite)
// Si necesitas autenticación, agrega aquí tus cookies o headers
const AUTH = {
  cookies: [
    // { name: 'DTCookie', value: 'XXXX', domain: 'TU-DT', path: '/' }
  ],
  headers: {
    // 'Authorization': 'Api-Token XXXXX',
  }
};

// Inicializa el servidor Express y sirve archivos estáticos
const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Carpeta donde se guardan las capturas
const shotsDir = path.join(__dirname, 'public', 'shots');
fs.mkdirSync(shotsDir, { recursive: true });

// Función principal que toma capturas de todas las URLs
async function captureAll() {
  //console.log('[DEBUG] Starting captureAll, targets:', TARGETS);
  
  let browser;
  
  try {
    console.log('Iniciando navegador...');
    
    // Configuración optimizada para serverless/cloud
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    // Procesar todas las URLs
    for (const t of TARGETS) {
      // Abre una nueva pestaña por cada URL
      const page = await browser.newPage();
      await page.setViewport(VIEWPORT);

      // Aplica headers si se definieron
      if (AUTH.headers && Object.keys(AUTH.headers).length) {
        await page.setExtraHTTPHeaders(AUTH.headers);
      }

      // Inyecta cookies si hay
      if (AUTH.cookies && AUTH.cookies.length) {
        await page.setCookie(...AUTH.cookies);
      }

      try {
        // Navega a la URL y espera hasta 1 minuto
        await page.goto(t.url, { waitUntil: 'networkidle0', timeout: PAGE_TIMEOUT_MS });
        // Espera fija de 40 segundos para dar tiempo a que cargue el dashboard
        await new Promise(res => setTimeout(res, 40000));
        // Toma la captura de pantalla de lo que haya en ese momento
        const out = path.join(shotsDir, `${t.id}.png`);
        await page.screenshot({
          path: out,
          clip: {
            x: 0, // desde la izquierda
            y: 0, // desde arriba
            width: Math.floor(VIEWPORT.width * (2/3)), // 2/3 del ancho
            height: Math.floor(VIEWPORT.height * (2/3)) // 2/3 del alto
          }
        });
        //console.log(`[OK] ${t.id} -> ${out}`);
      } catch (e) {
        // Si hay error, lo muestra en consola
        console.error(`[FAIL] ${t.id} ${t.url}`, e.message);
      } finally {
        // Cierra la pestaña
        await page.close();
      }
    }
  } catch (mainError) {
    console.error('Error principal en captureAll:', mainError);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Lanza una captura al inicio
captureAll();
// Programa capturas periódicas cada N minutos
setInterval(captureAll, CAPTURE_EVERY_MIN * 60 * 1000);

// Endpoint que expone la lista actual de capturas para el front
app.get('/api/list', (req, res) => {
  // Devuelve la lista de imágenes y la fecha de generación
  const items = TARGETS.map(t => ({ id: t.id, img: `/shots/${t.id}.png`, title: t.id }));
  res.json({ items, generatedAt: new Date().toISOString() });
});

// Arranca el servidor en el puerto configurado
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Carousel listo en http://localhost:${PORT}`));
