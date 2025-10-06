// Módulo de captura y procesamiento real de imágenes
// Maneja viewport, navegación, screenshot con recorte, reintentos y limpieza de memoria
import path from 'path';

// Configuración del viewport para capturas (3200x1800)
const VIEWPORT = {
  width: 3200,
  height: 1800,
  deviceScaleFactor: 1
};

// Función principal de captura con reintentos
// Parámetros:
// - browser: instancia de Puppeteer
// - target: objeto {id, url} del dashboard
// - waitTime: tiempo de espera para carga completa (ms)
// - shotsDir: directorio donde guardar screenshots
// - auth: objeto con headers y cookies para autenticación
// - pageTimeout: timeout para navegación
// - maxRetries: número máximo de reintentos
// - isInitialLoad: flag para logging de primera carga
async function capturarConReintentos(browser, target, waitTime, shotsDir, auth = {}, pageTimeout = 90000, maxRetries = 2, isInitialLoad = false) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let page;
    try {
      console.log(`Navegando a ${target.id} (intento ${attempt}/${maxRetries}): ${target.url}`);
      if (isInitialLoad) {
        console.log(`🎯 Carga inicial - esperando ${waitTime/1000}s para renderizado completo`);
      }
      
      // Crear nueva página con viewport configurado
      page = await browser.newPage();
      await page.setViewport(VIEWPORT);
      
      // Configurar timeouts específicos
      page.setDefaultNavigationTimeout(120000); // 2 minutos para navegación
      page.setDefaultTimeout(60000); // 1 minuto para otras operaciones

      // Aplicar headers de autenticación si existen
      if (auth.headers && Object.keys(auth.headers).length) {
        await page.setExtraHTTPHeaders(auth.headers);
      }

      // Inyectar cookies de autenticación si existen
      if (auth.cookies && auth.cookies.length) {
        await page.setCookie(...auth.cookies);
      }

      // Navegar al dashboard y esperar que la red esté tranquila
      await page.goto(target.url, { 
        waitUntil: 'networkidle2',
        timeout: pageTimeout
      });
      
      console.log(`Esperando carga completa para ${target.id}... (${waitTime/1000}s)`);
      
      // Esperar tiempo base de carga
      await new Promise(res => setTimeout(res, waitTime));
      
      // Verificar si hay elementos de loading visibles y esperar adicional
      try {
        const loadingElements = await page.$$eval('[class*="loading"], [class*="Loading"], .dt-loading', 
          elements => elements.length
        );
        
        if (loadingElements > 0) {
          console.log(`⏳ ${target.id} todavía cargando, esperando 30s adicionales...`);
          await new Promise(res => setTimeout(res, 30000));
        }
      } catch (e) {
        // Si falla la evaluación, continuar normalmente
      }
      
      // Capturar screenshot con recorte (2/3 del viewport = 2133x1200)
      const out = path.join(shotsDir, `${target.id}.png`);
      await page.screenshot({
        path: out,
        clip: {
          x: 0,
          y: 0,
          width: Math.floor(VIEWPORT.width * (2/3)), // 2133px
          height: Math.floor(VIEWPORT.height * (2/3)) // 1200px
        },
        timeout: 45000
      });
      
      console.log(`[OK] ${target.id} capturado exitosamente`);
      
      // Limpieza agresiva de memoria después de captura exitosa
      if (global.gc) {
        global.gc();
        console.log(`🧹 Limpieza de memoria ejecutada para ${target.id}`);
      }
      
      return true;
      
    } catch (error) {
      console.error(`[FAIL] ${target.id} (intento ${attempt}/${maxRetries}):`, error.message);
      if (attempt === maxRetries) {
        return false;
      }
      // Esperar 5 segundos antes del siguiente intento
      await new Promise(res => setTimeout(res, 5000));
    } finally {
      // Cerrar página para liberar memoria
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

export { capturarConReintentos, VIEWPORT };
