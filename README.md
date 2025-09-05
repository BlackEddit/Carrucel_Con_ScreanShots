# Carrusel de Dashboards con Capturas Automáticas

Sistema que captura screenshots de dashboards Dynatrace y los muestra en un carrusel rotativo.

## Características

- ✨ **Captura Incremental**: Actualiza un dashboard a la vez para mantener el carrusel siempre activo
- 🔄 **Persistencia**: Mantiene el estado entre reinicios del servidor
- 📊 **Diagnóstico**: Endpoints con información detallada para solucionar problemas
- 🌐 **Frontend Robusto**: Interfaz que se recupera automáticamente de errores
- 🔒 **Gestión de Memoria**: Optimizada para entornos con restricciones de recursos

## Explicación del flujo

1. **server.js**: Arranca el servidor Express y configura el sistema de capturas incrementales.
2. **Captura Incremental**: Un dashboard a la vez es capturado y actualizado, manteniendo el resto disponibles.
3. **Estado Persistente**: Se guarda el progreso para recuperarlo después de reinicios del servidor.
4. **Express**: Sirve la carpeta `public/` y expone varios endpoints de API para datos y diagnóstico.
5. **Frontend Robusto**: El carrusel muestra imágenes disponibles y se recupera automáticamente de errores.

## Configuración

El sistema se configura a través de variables de entorno en un archivo `.env`:

```
DASHBOARD_URLS="https://url1.dynatrace.com/dashboard1;;;https://url2.dynatrace.com/dashboard2;;;https://url3.dynatrace.com/dashboard3"
PORT=3000
```

## Endpoints

- `/`: Interfaz principal del carrusel
- `/api/list`: Lista de dashboards disponibles
- `/api/status`: Estado actual del sistema
- `/api/diagnostics`: Información detallada para diagnóstico

## Desarrollo

```bash
# Instalar dependencias
npm install

# Iniciar en modo desarrollo
npm run dev

# Iniciar con inspección para debugging
npm run debug
```

## ¿Por qué rutas relativas?
- Permiten que el código funcione sin importar desde dónde lo ejecutes.
- Así puedes guardar y leer archivos en carpetas del proyecto sin problemas de path.

## Solución de problemas

Si el carrusel no muestra dashboards:

1. Revisar los logs del servidor
2. Verificar el endpoint `/api/diagnostics` para información detallada
3. Asegurarse que las URLs de los dashboards son accesibles
4. Comprobar que la carpeta `/public/shots` tiene permisos de escritura

---

