import "dotenv/config";
import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(express.static("public"));

const {
  BOT_TOKEN,
  BOT_USERNAME,
  APP_SHORT_NAME = "spymaster",
  PORT = 3000
} = process.env;

if (!BOT_TOKEN) {
  console.error("Falta BOT_TOKEN");
  process.exit(1);
}

const games = new Map();

const WORDS = [
  "ÁGUILA","MOTOR","LUNA","REY","VIDRIO","BOMBA","CABALLO","CHINA","PLATA","NUBE",
  "TREN","MÉDICO","PUERTO","CARTA","FUEGO","TORRE","PIANO","BOSQUE","CORONA","PARED",
  "PERRO","MARTE","BANCO","NIEVE","ANILLO","RÍO","CABLE","CLAVO","BARCO","CAMPO",
  "LLAVE","RELOJ","ROMA","DRAGÓN","GATO","PUENTE","SOL","MINA","AVIÓN","ROCA",
  "HIERRO","PLAYA","REINA","NOCHE","RADIO","PUMA","PLANTA","RAYO","MAPA","PUERTA"
];

function shuffle(a) {
  const arr = [...a];

  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

function createRoom(ownerId) {
  const id = crypto.randomBytes(3).toString("hex").toUpperCase();

  const words = shuffle(WORDS).slice(0, 25);

  const roles = shuffle([
    ...Array(9).fill("red"),
    ...Array(8).fill("blue"),
    ...Array(7).fill("neutral"),
    "assassin"
  ]);

  const g = {
    id,
    ownerId,
    status: "lobby",
    turn: "red",
    clue: null,
    redRemaining: 9,
    blueRemaining: 8,
    winner: null,
    players: {},
    cards: words.map((word, i) => ({
      word,
      role: roles[i],
      revealed: false
    })),
    updatedAt: Date.now()
  };

  games.set(id, g);
  return g;
}

function validateTelegramInitData(initData) {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) return null;

  params.delete("hash");
  params.delete("signature");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculated = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const a = Buffer.from(calculated, "hex");
  const b = Buffer.from(hash, "hex");

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }

  const authDate = Number(params.get("auth_date") || 0);

  if (!authDate || Date.now() / 1000 - authDate > 86400) {
    return null;
  }

  try {
    const user = JSON.parse(params.get("user") || "{}");

    if (!user.id) return null;

    return {
      user,
      startParam: params.get("start_param") || ""
    };
  } catch {
    return null;
  }
}

function auth(req, res, next) {
  const data = validateTelegramInitData(
    req.get("X-Telegram-Init-Data")
  );

  if (!data) {
    return res.status(401).json({
      error: "Telegram auth inválida"
    });
  }

  req.tg = data;
  next();
}

function getGame(req, res) {
  const g = games.get(
    String(req.params.room || "").toUpperCase()
  );

  if (!g) {
    res.status(404).json({
      error: "Partida inexistente"
    });
  }

  return g;
}

function touch(g) {
  g.updatedAt = Date.now();
}

function publicState(g, userId) {
  const me = g.players[userId];
  const isSpy = me?.role === "spymaster";

  return {
    id: g.id,
    status: g.status,
    turn: g.turn,
    clue: g.clue,
    redRemaining: g.redRemaining,
    blueRemaining: g.blueRemaining,
    winner: g.winner,
    ownerId: g.ownerId,
    me: me || null,
    players: Object.values(g.players),

    cards: g.cards.map(c => ({
      word: c.word,
      revealed: c.revealed,
      role: (c.revealed || isSpy) ? c.role : null
    })),

    updatedAt: g.updatedAt
  };
}

function switchTurn(g) {
  g.turn = g.turn === "red" ? "blue" : "red";
  g.clue = null;
}

app.get(
  "/api/room/:room",
  auth,
  (req, res) => {
    const g = getGame(req, res);

    if (g) {
      res.json(
        publicState(g, req.tg.user.id)
      );
    }
  }
);

app.post(
  "/api/room/:room/join",
  auth,
  (req, res) => {
    const g = getGame(req, res);

    if (!g) return;

    if (g.status !== "lobby") {
      return res.status(400).json({
        error: "La partida ya empezó"
      });
    }

    const team = req.body.team;

    if (!["red", "blue"].includes(team)) {
      return res.status(400).json({
        error: "Equipo inválido"
      });
    }

    const u = req.tg.user;

    g.players[u.id] = {
      id: u.id,
      name: [u.first_name, u.last_name]
        .filter(Boolean)
        .join(" "),
      username: u.username || "",
      team,
      role: "player"
    };

    touch(g);

    res.json(
      publicState(g, u.id)
    );
  }
);

app.post(
  "/api/room/:room/spymaster",
  auth,
  (req, res) => {
    const g = getGame(req, res);

    if (!g) return;

    if (g.status !== "lobby") {
      return res.status(400).json({
        error: "La partida ya empezó"
      });
    }

    const me = g.players[req.tg.user.id];

    if (!me) {
      return res.status(400).json({
        error: "Primero elegí equipo"
      });
    }

    for (const p of Object.values(g.players)) {
      if (p.team === me.team) {
        p.role = "player";
      }
    }

    me.role = "spymaster";

    touch(g);

    res.json(
      publicState(g, me.id)
    );
  }
);

app.post(
  "/api/room/:room/start",
  auth,
  (req, res) => {
    const g = getGame(req, res);

    if (!g) return;

    if (
      String(g.ownerId) !==
      String(req.tg.user.id)
    ) {
      return res.status(403).json({
        error: "Sólo quien creó la partida puede iniciarla"
      });
    }

    const ps = Object.values(g.players);

    if (
      !ps.some(
        p =>
          p.team === "red" &&
          p.role === "spymaster"
      ) ||
      !ps.some(
        p =>
          p.team === "blue" &&
          p.role === "spymaster"
      )
    ) {
      return res.status(400).json({
        error: "Cada equipo necesita un Spymaster"
      });
    }

    if (
      !ps.some(
        p =>
          p.team === "red" &&
          p.role === "player"
      ) ||
      !ps.some(
        p =>
          p.team === "blue" &&
          p.role === "player"
      )
    ) {
      return res.status(400).json({
        error: "Cada equipo necesita al menos un jugador además del Spymaster"
      });
    }

    g.status = "playing";
    touch(g);

    res.json(
      publicState(g, req.tg.user.id)
    );
  }
);

app.post(
  "/api/room/:room/clue",
  auth,
  (req, res) => {
    const g = getGame(req, res);

    if (!g) return;

    const me = g.players[req.tg.user.id];

    if (g.status !== "playing") {
      return res.status(400).json({
        error: "La partida no está activa"
      });
    }

    if (
      !me ||
      me.role !== "spymaster" ||
      me.team !== g.turn
    ) {
      return res.status(403).json({
        error: "No te toca dar pista"
      });
    }

    const word = String(req.body.word || "")
      .trim()
      .toUpperCase()
      .slice(0, 30);

    const number = Math.max(
      0,
      Math.min(
        9,
        Number(req.body.number)
      )
    );

    if (!word) {
      return res.status(400).json({
        error: "Falta la pista"
      });
    }

    g.clue = {
      word,
      number,
      team: g.turn
    };

    touch(g);

    res.json(
      publicState(g, me.id)
    );
  }
);

app.post(
  "/api/room/:room/reveal",
  auth,
  (req, res) => {
    const g = getGame(req, res);

    if (!g) return;

    const me = g.players[req.tg.user.id];

    if (g.status !== "playing") {
      return res.status(400).json({
        error: "La partida no está activa"
      });
    }

    if (
      !me ||
      me.role !== "player" ||
      me.team !== g.turn
    ) {
      return res.status(403).json({
        error: "No podés revelar ahora"
      });
    }

    const i = Number(req.body.index);
    const c = g.cards[i];

    if (!c || c.revealed) {
      return res.status(400).json({
        error: "Carta inválida"
      });
    }

    c.revealed = true;

    if (c.role === "red") {
      g.redRemaining--;
    }

    if (c.role === "blue") {
      g.blueRemaining--;
    }

    if (c.role === "assassin") {
      g.status = "finished";
      g.winner =
        g.turn === "red"
          ? "blue"
          : "red";
    } else if (g.redRemaining === 0) {
      g.status = "finished";
      g.winner = "red";
    } else if (g.blueRemaining === 0) {
      g.status = "finished";
      g.winner = "blue";
    } else if (c.role !== g.turn) {
      switchTurn(g);
    }

    touch(g);

    res.json(
      publicState(g, me.id)
    );
  }
);

app.post(
  "/api/room/:room/end-turn",
  auth,
  (req, res) => {
    const g = getGame(req, res);

    if (!g) return;

    const me = g.players[req.tg.user.id];

    if (g.status !== "playing") {
      return res.status(400).json({
        error: "La partida no está activa"
      });
    }

    if (
      !me ||
      me.role !== "player" ||
      me.team !== g.turn
    ) {
      return res.status(403).json({
        error: "No podés terminar este turno"
      });
    }

    switchTurn(g);
    touch(g);

    res.json(
      publicState(g, me.id)
    );
  }
);

app.get(
  "/health",
  (_, res) => res.send("ok")
);

app.listen(PORT, () => {
  console.log(`Spymaster en puerto ${PORT}`);
  startBotPolling();
});

async function tg(method, body = {}) {
  const r = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = await r.json();

  if (!data.ok) {
    throw new Error(
      `Telegram ${method}: ${data.error_code || ""} ${data.description || "Error desconocido"}`
    );
  }

  return data;
}

async function startBotPolling() {
  let offset = 0;

  try {
    await tg(
      "deleteWebhook",
      { drop_pending_updates: false }
    );

    const me = await tg("getMe");
    const username = me.result.username;

    console.log(
      `Bot conectado como @${username}`
    );

    console.log(
      "Bot polling iniciado"
    );

    while (true) {
      try {
        const data = await tg(
          "getUpdates",
          {
            offset,
            timeout: 30,
            allowed_updates: ["message"]
          }
        );

        for (const upd of data.result) {
          offset = upd.update_id + 1;

          const msg = upd.message;
          const text =
            (msg?.text || "").trim();

          if (
            /^\/start(@\w+)?$/i.test(text)
          ) {
            await tg(
              "sendMessage",
              {
                chat_id: msg.chat.id,
                text:
                  "🕵️ Codenames listo. Mandá /nuevo para crear una partida."
              }
            );

            continue;
          }

          if (
            /^\/(nuevo|new)(@\w+)?$/i.test(text)
          ) {
            const room =
              createRoom(msg.from.id);

            const miniAppLink =
              `https://t.me/${username}/${APP_SHORT_NAME}?startapp=${room.id}`;

            await tg(
              "sendMessage",
              {
                chat_id: msg.chat.id,

                text:
                  `🕵️ Nueva partida Codenames\n\n` +
                  `Sala: ${room.id}\n\n` +
                  `Entren desde el botón.`,

                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text:
                          "🎮 Entrar a la partida",
                        url: miniAppLink
                      }
                    ]
                  ]
                }
              }
            );

            console.log(
              `Partida ${room.id} creada por ${msg.from.id}`
            );
          }
        }
      } catch (e) {
        console.error(
          "Polling:",
          e.message
        );

        await new Promise(
          r => setTimeout(r, 2000)
        );
      }
    }
  } catch (e) {
    console.error(
      "No se pudo iniciar el bot:",
      e.message
    );
  }
}
