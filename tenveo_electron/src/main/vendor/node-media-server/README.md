# Piezas de protocolo de Node-Media-Server

Copia sin cambios de estos archivos de [Node-Media-Server](https://github.com/illuspas/Node-Media-Server) **4.4.3**, de Chen Mingliang, bajo la licencia Apache 2.0 incluida en `LICENSE`:

- `protocol/rtmp.js`: lado servidor del protocolo RTMP.
- `protocol/rtmp_client.js`: cliente RTMP para leer o publicar un stream.
- `protocol/amf.js` y `protocol/flv.js`: formatos AMF y FLV.
- `core/avpacket.js` y `core/logger.js`: estructuras de apoyo.

Tenveo Studio solo usa estas piezas para recibir el video del PC500 (`src/main/video-receiver.js`). El servidor completo de Node-Media-Server no se incluye.

`package.json` marca la carpeta como CommonJS, porque el resto de la app usa módulos ES.

Para actualizar: instala la versión nueva de `node-media-server` como dependencia de desarrollo, copia de nuevo los mismos archivos y corre `npm test`.
