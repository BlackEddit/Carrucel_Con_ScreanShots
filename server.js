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
const CAPTURE_EVERY_MIN = 25; // 25 minutos para 12 dashboards

// 3) Viewport de las capturas
// Tamaño de la ventana del navegador para la captura
const VIEWPORT = { width: 3200, height: 1800, deviceScaleFactor: 1 };

// 4) Timeout de carga por página (ms)
// Tiempo máximo para que Puppeteer navegue a la página
const PAGE_TIMEOUT_MS = 180_000; // 3 minutos para dashboards pesados

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

// Variables para tracking del progreso
let captureInProgress = false;
let captureProgress = 0;
let totalDashboards = 0;
let successfulCaptures = 0;
let failedCaptures = 0;

// Función para capturar un dashboard individual con reintentos
async function captureWithRetries(browser, target, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let page;
    try {
      console.log(`Navegando a ${target.id} (intento ${attempt}/${maxRetries}): ${target.url}`);
      
      // Crear nueva página con timeout individual
      page = await browser.newPage();
      await page.setViewport(VIEWPORT);
      
      // Configurar timeouts específicos para esta página
      page.setDefaultNavigationTimeout(120000); // 2 minutos para navegación
      page.setDefaultTimeout(60000); // 1 minuto para otras operaciones

      // Aplica headers si se definieron
      if (AUTH.headers && Object.keys(AUTH.headers).length) {
        await page.setExtraHTTPHeaders(AUTH.headers);
      }

      // Inyecta cookies si hay
      if (AUTH.cookies && AUTH.cookies.length) {
        await page.setCookie(...AUTH.cookies);
      }

      await page.goto(target.url, { 
        waitUntil: 'domcontentloaded',
        timeout: 120000 // 2 minutos por dashboard
      });
      
      console.log(`Esperando carga para ${target.id}...`);
      await new Promise(res => setTimeout(res, 45000)); // 45 segundos
      
      const out = path.join(shotsDir, `${target.id}.png`);
      await page.screenshot({
        path: out,
        clip: {
          x: 0,
          y: 0,
          width: Math.floor(VIEWPORT.width * (2/3)),
          height: Math.floor(VIEWPORT.height * (2/3))
        },
        timeout: 60000 // 1 minuto para screenshot
      });
      
      console.log(`[OK] ${target.id} capturado exitosamente`);
      successfulCaptures++;
      return true;
      
    } catch (error) {
      console.error(`[FAIL] ${target.id} (intento ${attempt}/${maxRetries}):`, error.message);
      if (attempt === maxRetries) {
        failedCaptures++;
        return false;
      }
      // Esperar antes del siguiente intento
      await new Promise(res => setTimeout(res, 5000));
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          console.log(`Error cerrando página ${target.id}:`, e.message);
        }
      }
    }
  }
  return false;
}

// Función principal que toma capturas de todas las URLs
async function captureAll() {
  console.log(`[DEBUG] Iniciando captura de ${TARGETS.length} dashboards`);
  
  captureInProgress = true;
  captureProgress = 0;
  successfulCaptures = 0;
  failedCaptures = 0;
  totalDashboards = TARGETS.length;
  
  let browser;
  
  try {
    console.log('Iniciando navegador...');
    
    // Configuración optimizada para serverless/cloud y múltiples dashboards
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--max-old-space-size=6144', // Más memoria
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-dev-shm-usage',
        '--no-zygote',
        '--single-process'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      protocolTimeout: 300000, // 5 minutos timeout para operaciones críticas
    });

    // Procesar todas las URLs con control de errores mejorado
    for (const target of TARGETS) {
      try {
        await captureWithRetries(browser, target);
      } catch (error) {
        console.error(`Error crítico con ${target.id}:`, error.message);
        failedCaptures++;
      } finally {
        captureProgress++;
        console.log(`Progreso: ${captureProgress}/${totalDashboards} (${successfulCaptures} exitosos, ${failedCaptures} fallidos)`);
      }
      
      // Pequeña pausa entre dashboards para liberar memoria
      await new Promise(res => setTimeout(res, 2000));
    }
  } catch (mainError) {
    console.error('Error principal en captureAll:', mainError);
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('Navegador cerrado correctamente');
      } catch (e) {
        console.error('Error cerrando navegador:', e.message);
      }
    }
    captureInProgress = false;
    console.log(`[FINISH] Captura completada: ${successfulCaptures} exitosos, ${failedCaptures} fallidos de ${totalDashboards} total`);
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
  res.json({ 
    items, 
    generatedAt: new Date().toISOString(),
    loading: captureInProgress,
    progress: captureProgress,
    total: totalDashboards
  });
});

// Endpoint de estado de progreso
app.get('/api/status', (req, res) => {
  res.json({
    loading: captureInProgress,
    progress: captureProgress,
    total: totalDashboards,
    successful: successfulCaptures,
    failed: failedCaptures,
    percentage: totalDashboards > 0 ? Math.round((captureProgress / totalDashboards) * 100) : 0
  });
});

// Arranca el servidor en el puerto configurado
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Carousel listo en http://localhost:${PORT}`));

// Manejo de señales para evitar que Render reinicie el servicio
process.on('SIGTERM', async () => {
  console.log('SIGTERM recibido, cerrando gracefully...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT recibido, cerrando gracefully...');
  process.exit(0);
});

// Manejo de errores no capturados para evitar crashes
process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
  // No salir del proceso, solo loggear
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promise rechazada no manejada en:', promise, 'razón:', reason);
  // No salir del proceso, solo loggear
});
