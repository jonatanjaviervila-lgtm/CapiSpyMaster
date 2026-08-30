# Spymaster para Telegram

## Funciones
- `/nuevo` crea una sala.
- El bot manda un botón para abrir la Mini App.
- Telegram identifica a cada usuario.
- Equipos rojo/azul y un Spymaster por equipo.
- Sólo el Spymaster ve el mapa secreto.
- Tablero sincronizado entre jugadores.
- Asesino, neutrales, turnos y victoria.

## Configuración
1. Crear el bot con @BotFather.
2. En @BotFather configurar una **Main Mini App** para ese bot.
3. Usar un short name, por ejemplo `spymaster`.
4. La URL de la Mini App debe ser HTTPS y apuntar a este proyecto desplegado.
5. Copiar `.env.example` como `.env` y completar:
   - `BOT_TOKEN`
   - `BOT_USERNAME` (sin @)
   - `APP_SHORT_NAME` (igual al short name de BotFather)
6. Ejecutar `npm install` y `npm start`.
7. En Telegram usar `/nuevo`.

## Importante
Esta primera versión guarda las partidas en RAM. Si reiniciás el servidor, se pierden. Para producción conviene agregar SQLite/PostgreSQL o Redis.
