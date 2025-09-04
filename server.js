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
const CAPTURE_EVERY_MIN = 30; // 30 minutos para 12 dashboards

// 3) Viewport de las capturas
// Tamaño de la ventana del navegador para la captura
const VIEWPORT = { width: 3200, height: 1800, deviceScaleFactor: 1 };

// 4) Timeout de carga por página (ms) - REDUCIDO para captura inicial más rápida
// Tiempo máximo para que Puppeteer navegue a la página
const PAGE_TIMEOUT_MS = 90_000; // 1.5 minutos para dashboards pesados

// 5) Configuración de captura paralela
const MAX_CONCURRENT_CAPTURES = 4; // Máximo 4 dashboards al mismo tiempo
const WAIT_TIME_PER_DASHBOARD = 25000; // 25 segundos por dashboard (reducido)

// 6) Opcional: headers/cookies de sesión (solo si tu seguridad lo permite)
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

// Función para crear placeholder mientras se cargan los dashboards reales
function createPlaceholderImages() {
  console.log('🖼️  Creando imágenes placeholder para inicio inmediato...');
  
  TARGETS.forEach(target => {
    const placeholderPath = path.join(shotsDir, `${target.id}.png`);
    
    // Solo crear placeholder si no existe la imagen real
    if (!fs.existsSync(placeholderPath)) {
      // Crear una imagen placeholder simple (puedes usar cualquier imagen base64)
      const placeholderSVG = `
        <svg width="2133" height="1200" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="#1e2836"/>
          <text x="50%" y="45%" text-anchor="middle" fill="#d2f7d0" font-size="48" font-family="Arial">
            🔄 Cargando ${target.id}
          </text>
          <text x="50%" y="55%" text-anchor="middle" fill="#888" font-size="24" font-family="Arial">
            Capturando dashboard en tiempo real...
          </text>
        </svg>
      `;
      
      // Nota: En producción podrías usar una imagen PNG real o generarla con Canvas
      // Por simplicidad, creamos un archivo temporal que luego será reemplazado
      try {
        fs.writeFileSync(placeholderPath + '.placeholder', placeholderSVG);
        console.log(`📋 Placeholder creado para ${target.id}`);
      } catch (e) {
        console.log(`⚠️  No se pudo crear placeholder para ${target.id}:`, e.message);
      }
    }
  });
}

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
        timeout: PAGE_TIMEOUT_MS
      });
      
      console.log(`Esperando carga para ${target.id}...`);
      await new Promise(res => setTimeout(res, WAIT_TIME_PER_DASHBOARD)); // Tiempo reducido
      
      const out = path.join(shotsDir, `${target.id}.png`);
      await page.screenshot({
        path: out,
        clip: {
          x: 0,
          y: 0,
          width: Math.floor(VIEWPORT.width * (2/3)),
          height: Math.floor(VIEWPORT.height * (2/3))
        },
        timeout: 45000 // 45 segundos para screenshot
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

// Función para procesar dashboards en lotes paralelos
async function captureInBatches(browser, targets, batchSize) {
  const results = [];
  
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    console.log(`\n🚀 Procesando lote ${Math.floor(i/batchSize) + 1}: ${batch.map(t => t.id).join(', ')}`);
    
    // Capturar todos los dashboards del lote en paralelo
    const batchPromises = batch.map(target => 
      captureWithRetries(browser, target).then(success => {
        captureProgress++;
        console.log(`📊 Progreso: ${captureProgress}/${totalDashboards} (${successfulCaptures} exitosos, ${failedCaptures} fallidos)`);
        return { target, success };
      })
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Pausa corta entre lotes para liberar memoria
    if (i + batchSize < targets.length) {
      console.log(`⏱️  Pausa de 3 segundos antes del siguiente lote...`);
      await new Promise(res => setTimeout(res, 3000));
    }
  }
  
  return results;
}

// Función principal que toma capturas de todas las URLs
async function captureAll() {
  console.log(`[DEBUG] Iniciando captura PARALELA de ${TARGETS.length} dashboards`);
  console.log(`🔧 Configuración: ${MAX_CONCURRENT_CAPTURES} dashboards en paralelo, ${WAIT_TIME_PER_DASHBOARD/1000}s de espera por dashboard`);
  
  captureInProgress = true;
  captureProgress = 0;
  successfulCaptures = 0;
  failedCaptures = 0;
  totalDashboards = TARGETS.length;
  
  let browser;
  const startTime = Date.now();
  
  try {
    console.log('🌐 Iniciando navegador...');
    
    // Configuración optimizada para captura paralela
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--max-old-space-size=8192', // 8GB para múltiples páginas paralelas
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      protocolTimeout: 300000, // 5 minutos timeout
    });

    // Procesar dashboards en lotes paralelos
    await captureInBatches(browser, TARGETS, MAX_CONCURRENT_CAPTURES);
    
  } catch (mainError) {
    console.error('❌ Error principal en captureAll:', mainError);
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log('✅ Navegador cerrado correctamente');
      } catch (e) {
        console.error('⚠️  Error cerrando navegador:', e.message);
      }
    }
    captureInProgress = false;
    
    const endTime = Date.now();
    const duration = Math.round((endTime - startTime) / 1000);
    console.log(`\n🎉 [FINISH] Captura completada en ${duration} segundos:`);
    console.log(`   ✅ Exitosos: ${successfulCaptures}`);
    console.log(`   ❌ Fallidos: ${failedCaptures}`);
    console.log(`   📊 Total: ${totalDashboards} dashboards`);
    console.log(`   ⚡ Promedio: ${Math.round(duration/totalDashboards)} segundos por dashboard\n`);
  }
}

// 🚀 INICIO OPTIMIZADO DEL SISTEMA
console.log('\n🎯 ============ INICIANDO SISTEMA DE DASHBOARDS ============');
console.log(`📊 Total de dashboards configurados: ${TARGETS.length}`);
console.log(`⚡ Modo de captura: PARALELO (${MAX_CONCURRENT_CAPTURES} simultáneos)`);
console.log(`⏱️  Tiempo por dashboard: ${WAIT_TIME_PER_DASHBOARD/1000} segundos`);
console.log(`🔄 Intervalo de actualización: ${CAPTURE_EVERY_MIN} minutos`);

// Crear placeholders para que el carrusel funcione inmediatamente
createPlaceholderImages();

// Lanza una captura al inicio (esto ahora será PARALELO y más rápido)
console.log('\n🚀 Iniciando primera captura de dashboards...');
captureAll();

// Programa capturas periódicas cada N minutos
setInterval(() => {
  console.log(`\n🔄 Iniciando actualización programada de dashboards...`);
  captureAll();
}, CAPTURE_EVERY_MIN * 60 * 1000);

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
