import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===== CONFIG =====

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

if (!WHATSAPP_TOKEN || !PHONE_ID) {
  console.error("❌ Falta WHATSAPP_TOKEN o PHONE_ID");
  process.exit(1);
}

// ===== MEMORIA =====

const users = {};
const reservas = {}; 
// reservas[barbero][fecha] = [horas ocupadas]

// ===== BARBEROS =====

const BARBEROS = ["Carlos", "Andrés", "Miguel"];

// ===== SERVICIOS =====

const SERVICIOS = {
  "1": { nombre: "Corte", precio: 20000 },
  "2": { nombre: "Barba", precio: 15000 },
  "3": { nombre: "Corte + Barba", precio: 32000 }
};

// ==== Bloqueo de horas barberos ====

const axios = require("axios");

async function horasOcupadas(barbero, fecha) {
  const url = `${process.env.SHEET_API}?barbero=${encodeURIComponent(barbero)}&fecha=${fecha}`;
  const res = await axios.get(url);
  return res.data;
};

const HORAS = [
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00"
];

// ===== WEBHOOK VERIFY =====

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ===== WEBHOOK MENSAJES =====

app.post("/webhook", async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg) return res.sendStatus(200);

    const from = msg.from;
    const text = msg.text?.body?.toLowerCase()?.trim();

    if (!users[from]) users[from] = { step: "saludo" };
    const user = users[from];

// ================= FLUJO =================

    // 🔹 SALUDO
    if (user.step === "saludo") {
      await send(from,
`👋 Bienvenido a *Barbería Elite*

Para agendar tu cita necesito:

✍️ Nombre
📱 Celular

Ejemplo:
Juan Pérez, 3001234567`);
      user.step = "datos";
    }

    // 🔹 DATOS
    else if (user.step === "datos") {
      const p = text.split(",");
      if (p.length < 2) {
        await send(from, "❌ Formato incorrecto");
        return res.sendStatus(200);
      }

      user.nombre = p[0].trim();
      user.telefono = p[1].trim();

      await send(from,
`💈 Selecciona barbero:

1️⃣ Carlos
2️⃣ Andrés
3️⃣ Miguel`);

      user.step = "barbero";
    }

    // 🔹 BARBERO
    else if (user.step === "barbero") {
      const idx = parseInt(text) - 1;
      if (!BARBEROS[idx]) {
        await send(from, "❌ Opción inválida");
        return res.sendStatus(200);
      }

      user.barbero = BARBEROS[idx];

      const fechas = fechasDisponibles();
      user.fechas = fechas;

      await send(from,
`📅 Fechas disponibles (30 días):

${fechas.map((f,i)=>`${i+1}️⃣ ${f}`).join("\n")}

Escribe el número`);
      user.step = "fecha";
    }

    // 🔹 FECHA
    else if (user.step === "fecha") {
      const idx = parseInt(text) - 1;
      const fecha = user.fechas[idx];
      if (!fecha) {
        await send(from,"❌ Fecha inválida");
        return res.sendStatus(200);
      }

      user.fecha = fecha;

      const libres = horasLibres(user.barbero, fecha);
      if (libres.length === 0) {
        await send(from,"⚠️ No hay horas ese día");
        return res.sendStatus(200);
      }

      user.horas = libres;

      await send(from,
`⏰ Horas disponibles:

${libres.map((h,i)=>`${i+1}️⃣ ${h}`).join("\n")}

Escribe el número`);
      user.step = "hora";
    }

    // 🔹 HORA
    else if (user.step === "hora") {
      const idx = parseInt(text) - 1;
      const hora = user.horas[idx];
      if (!hora) {
        await send(from,"❌ Hora inválida");
        return res.sendStatus(200);
      }

      user.hora = hora;

      await send(from,
`✂️ Servicios:

1️⃣ Corte — $20.000
2️⃣ Barba — $15.000
3️⃣ Corte + Barba — $32.000`);

      user.step = "servicio";
    }

    // 🔹 SERVICIO
    else if (user.step === "servicio") {
      const s = SERVICIOS[text];
      if (!s) {
        await send(from,"❌ Servicio inválido");
        return res.sendStatus(200);
      }

      user.servicio = s;

      await send(from,
`✅ CONFIRMAR CITA

Cliente: ${user.nombre}
Barbero: ${user.barbero}
Fecha: ${user.fecha}
Hora: ${user.hora}
Servicio: ${s.nombre}
Precio: $${s.precio}

Responde SI para confirmar`);

      user.step = "confirmar";
    }

    // 🔹 CONFIRMAR
    else if (user.step === "confirmar") {
      if (text !== "si") {
        await send(from,"❌ Cita cancelada");
        delete users[from];
        return res.sendStatus(200);
      }

      guardarReserva(user.barbero, user.fecha, user.hora);

      await send(from,
`🎉 Cita agendada correctamente

Nos vemos 💈`);

      delete users[from];
    }

    res.sendStatus(200);

  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// ===== FUNCIONES =====

function fechasDisponibles() {
  const hoy = new Date();
  const arr = [];
  for (let i=0;i<30;i++){
    const d = new Date(hoy);
    d.setDate(d.getDate()+i);
    arr.push(d.toISOString().slice(0,10));
  }
  return arr;
}

function horasLibres(barbero, fecha) {
  const ocupadas = reservas[barbero]?.[fecha] || [];
  return HORAS.filter(h => !ocupadas.includes(h));
}

function guardarReserva(barbero, fecha, hora) {
  if (!reservas[barbero]) reservas[barbero] = {};
  if (!reservas[barbero][fecha]) reservas[barbero][fecha] = [];
  reservas[barbero][fecha].push(hora);
}

async function send(to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

app.listen(PORT, () => console.log("💈 Bot barbería activo"));
