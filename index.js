import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const SHEET_API = process.env.SHEET_API; 

const BARBEROS = ["Carlos", "Andrés", "Miguel"];
const SERVICIOS = {
  "1": { nombre: "Corte", precio: 20000 },
  "2": { nombre: "Barba", precio: 15000 },
  "3": { nombre: "Corte + Barba", precio: 32000 }
};
const HORAS = ["08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30", "18:00", "18:30", "19:00"];

const users = {};
const timers = {}; 

// --- FUNCIÓN PARA CONVERTIR NÚMEROS A EMOJIS AZULES ---
function obtenerEmoji(numero) {
  const mapping = {
    '0': '0️⃣', '1': '1️⃣', '2': '2️⃣', '3': '3️⃣', '4': '4️⃣',
    '5': '5️⃣', '6': '6️⃣', '7': '7️⃣', '8': '8️⃣', '9': '9️⃣'
  };
  return numero.toString().split('').map(digito => mapping[digito]).join('');
}

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const msg = value?.messages?.[0];

    if (!msg || msg.type !== 'text' || !msg.text?.body) {
      return res.sendStatus(200);
    }

    const from = msg.from;
    const text = msg.text.body.toLowerCase().trim();

    if (timers[from]) clearTimeout(timers[from]);
    
    timers[from] = setTimeout(async () => {
      if (users[from]) {
        delete users[from];
        await send(from, "⏰ *Sesión finalizada por inactividad.*\n\nSi aún deseas realizar tu gestión, escribe *HOLA* de nuevo.");
        console.log(`Sesión eliminada por inactividad: ${from}`);
      }
    }, 2 * 60 * 1000); 

    if (text === "hola" || text === "inicio" || text === "menú") {
      delete users[from];
    }

    if (!users[from]) users[from] = { step: "saludo" };
    const user = users[from];

    if (user.step === "saludo") {
      await send(from, `👋 Bienvenido a *Barbería Elite*\n\nNuestros servicios y precios:\n\nCorte — $20.000\nBarba — $15.000\nCorte + Barba — $32.000\n\n¿Qué deseas hacer?\n\n1️⃣ *Agendar cita*\n2️⃣ *Cancelar cita*\n\nEscribe el número de tu opción.`);
      user.step = "menu_principal";
    }

    else if (user.step === "menu_principal") {
      if (text === "1") {
        await send(from, `Perfecto, vamos a agendar. Escribe tu *Nombre, apellido y Celular*.\n\nEjemplo: Juan Pérez, 3001234567`);
        user.step = "datos";
      } else if (text === "2") {
        await send(from, `Entiendo. Por favor, escribe el *Nombre* con el que registraste la cita para buscarla.`);
        user.step = "buscar_por_nombre";
      } else {
        await send(from, "❌ Opción inválida. Elige *1* para agendar o *2* para cancelar.");
      }
    }

    else if (user.step === "buscar_por_nombre") {
      await send(from, `⏳ Buscando citas para *${text}*...`);
      try {
        const res = await axios.post(SHEET_API, { accion: "consultar_citas", nombre: text });
        const citas = res.data.citas;

        if (citas && citas.length > 0) {
          user.citasPendientes = citas;
          let mensaje = "He encontrado estas citas. ¿Cuál deseas cancelar? (Escribe el número):\n\n";
          citas.forEach((c, i) => {
            mensaje += `${obtenerEmoji(i + 1)} *${c.cliente}* - ${c.fecha} a las ${c.hora} con ${c.barbero}\n`;
          });
          await send(from, mensaje);
          user.step = "seleccionar_cancelacion";
        } else {
          await send(from, `❌ No encontré ninguna cita para "${text}". Escribe *HOLA* para volver a intentarlo.`);
          delete users[from];
        }
      } catch (error) {
        await send(from, "❌ Error al conectar con la agenda. Intenta más tarde.");
        delete users[from];
      }
    }

    else if (user.step === "seleccionar_cancelacion") {
      const idx = parseInt(text) - 1;
      const cita = user.citasPendientes?.[idx];

      if (cita) {
        await send(from, `⏳ Cancelando la cita de *${cita.cliente}*...`);
        const res = await axios.post(SHEET_API, { 
          accion: "confirmar_cancelacion", 
          id: cita.id, 
          hoja: cita.hoja 
        });
        if (res.data.ok) {
          await send(from, `✅ Cita del día *${cita.fecha}* ha sido cancelada con éxito.`);
        } else {
          await send(from, `❌ No pudimos cancelar la cita. Por favor intenta de nuevo.`);
        }
      } else {
        await send(from, "❌ Opción inválida. Elige un número de la lista.");
        return;
      }
      delete users[from];
    }

    else if (user.step === "datos") {
      const p = text.split(",");
      if (p.length < 2) return await send(from, "❌ Formato incorrecto. Usa: Nombre, Teléfono");
      user.nombre = p[0].trim();
      user.telefono = p[1].trim();
      await mostrarBarberos(from, user);
    }

    else if (user.step === "esperar_barbero") {
      const idx = parseInt(text) - 1;
      if (!BARBEROS[idx]) return await send(from, "❌ Elige 1, 2 o 3.");
      user.barbero = BARBEROS[idx];
      if (user.servicio) await mostrarResumen(from, user);
      else await mostrarFechas(from, user);
    }

    else if (user.step === "esperar_fecha") {
      const idx = parseInt(text) - 1;
      if (!user.fechas?.[idx]) return await send(from, "❌ Fecha inválida.");
      user.fecha = user.fechas[idx];
      await send(from, `🔍 Consultando turnos para el ${user.fecha}...`);
      await mostrarHoras(from, user);
    }

    else if (user.step === "esperar_hora") {
      const idx = parseInt(text) - 1;
      if (user.listaHorasDisponibles && idx === user.listaHorasDisponibles.length) {
        return await mostrarFechas(from, user);
      }
      if (!user.listaHorasDisponibles || !user.listaHorasDisponibles[idx]) {
        return await send(from, "❌ Opción inválida. Elige un número de la lista.");
      }
      user.hora = user.listaHorasDisponibles[idx];
      if (user.servicio) await mostrarResumen(from, user);
      else await mostrarServicios(from, user);
    }

    else if (user.step === "esperar_servicio") {
      const s = SERVICIOS[text];
      if (!s) return await send(from, "❌ Opción inválida.");
      user.servicio = s;
      await mostrarResumen(from, user);
    }

    else if (user.step === "confirmar") {
      if (text === "si") {
        await send(from, "⏳ Finalizando tu reserva...");
        const exito = await guardarReserva(user);
        if (exito) {
          await send(from, `🎉 *¡Cita Confirmada!*\n\nTe esperamos el ${user.fecha} a las ${user.hora}. 💈`);
          delete users[from];
        } else {
          await send(from, "❌ Error al guardar. Escribe *SI* para reintentar o *HOLA* para reiniciar.");
        }
      } 
      else if (text === "modificar") {
        user.step = "menu_modificar";
        await send(from, `¿Qué deseas cambiar?\n\n1️⃣ Barbero\n2️⃣ Fecha\n3️⃣ Hora\n4️⃣ Servicio\n5️⃣ Reiniciar todo`);
      } 
      else if (text === "cancelar") {
        await send(from, "❌ Proceso cancelado. Escribe 'hola' para empezar de nuevo.");
        delete users[from];
      }
    }

    else if (user.step === "menu_modificar") {
      if (text === "1") await mostrarBarberos(from, user);
      else if (text === "2") await mostrarFechas(from, user);
      else if (text === "3") {
        await send(from, "🔍 Actualizando horarios...");
        await mostrarHoras(from, user);
      }
      else if (text === "4") await mostrarServicios(from, user);
      else if (text === "5") { delete users[from]; await send(from, "Hola"); }
      else await send(from, "❌ Elige una opción (1-5)");
    }

    res.sendStatus(200);
  } catch (e) {
    console.error("Error en Webhook:", e.message);
    res.sendStatus(200);
  }
});

async function mostrarBarberos(from, user) {
  user.step = "esperar_barbero";
  await send(from, `💈 Selecciona tu barbero preferido:\n\n1️⃣ Carlos\n2️⃣ Andrés\n3️⃣ Miguel`);
}

async function mostrarFechas(from, user) {
  user.fechas = Array.from({length: 15}, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
  user.step = "esperar_fecha";
  const listaFechas = user.fechas.map((f, i) => `${obtenerEmoji(i + 1)} ${f}`).join("\n");
  await send(from, `📅 Selecciona una fecha:\n\n${listaFechas}\n\nEscribe el número correspondiente.`);
}

async function mostrarHoras(from, user) {
  const ocupadas = await obtenerHorasOcupadas(user.barbero, user.fecha);
  user.listaHorasDisponibles = HORAS.filter(h => !ocupadas.includes(h));
  user.step = "esperar_hora";
  let mensajeHoras = user.listaHorasDisponibles.map((h, i) => `${obtenerEmoji(i + 1)} ${h}`).join("\n");
  const opcionVolver = user.listaHorasDisponibles.length + 1;
  mensajeHoras += `\n\n${obtenerEmoji(opcionVolver)} *Cambiar de fecha* 📅`;
  await send(from, `⏰ Horas disponibles para el ${user.fecha}:\n\n${mensajeHoras}\n\nEscribe el número correspondiente.`);
}

async function obtenerHorasOcupadas(barbero, fecha) {
  try {
    const res = await axios.get(`${SHEET_API}?barbero=${encodeURIComponent(barbero)}&fecha=${fecha}`, { timeout: 8000 });
    return Array.isArray(res.data) ? res.data.map(h => h.toString().replace(/'/g, "").trim()) : [];
  } catch (e) { return []; }
}

async function mostrarServicios(from, user) {
  user.step = "esperar_servicio";
  await send(from, `✂️ ¿Qué servicio deseas?\n\n1️⃣ Corte — $20.000\n2️⃣ Barba — $15.000\n3️⃣ Corte + Barba — $32.000`);
}

async function mostrarResumen(from, user) {
  user.step = "confirmar";
  await send(from, `✅ *RESUMEN DE TU CITA*\n\n👤 Cliente: ${user.nombre}\n💈 Barbero: ${user.barbero}\n📅 Fecha: ${user.fecha}\n⏰ Hora: ${user.hora}\n✂️ Servicio: ${user.servicio.nombre}\n💰 Precio: $${user.servicio.precio}\n\n¿Los datos son correctos?\n👍 Responde *SI* para confirmar\n🔄 Responde *MODIFICAR*\n❌ Responde *CANCELAR*`);
}

async function guardarReserva(user) {
  try {
    const res = await axios.post(SHEET_API, {
      nombre: user.nombre, telefono: user.telefono, barbero: user.barbero,
      fecha: user.fecha, hora: user.hora, servicio: user.servicio
    }, { timeout: 8000 });
    return res.data.ok;
  } catch (e) { return false; }
}

async function send(to, text) {
  try {
    await axios.post(`https://graph.facebook.com/v18.0/${PHONE_ID}/messages`, {
      messaging_product: "whatsapp", to, text: { body: text }
    }, { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` } });
  } catch (e) { console.error("Error envío WhatsApp:", e.response?.data || e.message); }
}

app.listen(PORT, () => console.log(`💈 Bot listo en puerto ${PORT}`));