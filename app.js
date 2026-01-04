// js/app.js
import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getFirestore, doc, getDoc, collection, addDoc,
  query, where, orderBy, getDocs, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const $ = (id) => document.getElementById(id);
const list = $("list");
const tenantNameEl = $("tenantName");

const kpiTotal = $("kpiTotal");
const kpiConfirmados = $("kpiConfirmados");
const kpiPendentes = $("kpiPendentes");

const formMsg = $("formMsg");

function setFormMsg(text, type="") {
  formMsg.className = "msg " + type;
  formMsg.textContent = text || "";
}

function onlyDigits(s="") {
  return (s || "").replace(/\D+/g, "");
}

function toISODate(d) {
  // yyyy-mm-dd (local)
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function makeWhatsAppLink(phoneDigits, text) {
  const phone = onlyDigits(phoneDigits);
  const msg = encodeURIComponent(text);
  // Brasil: usuário já digita DDD+numero. A gente prefixa 55.
  return `https://wa.me/55${phone}?text=${msg}`;
}

function escapeHtml(str="") {
  return str.replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

// -------- Multi-tenant (Spark friendly) --------
// Vamos mapear uid -> tenantId em /users/{uid}
// Documento exemplo:
// users/{uid} = { tenantId: "barbearia_joao", role: "admin" }
//
// E o tenant em /tenants/{tenantId} = { name: "Barbearia do João" }

async function getUserContext(uid) {
  const uref = doc(db, "users", uid);
  const usnap = await getDoc(uref);
  if (!usnap.exists()) return null;

  const u = usnap.data();
  if (!u.tenantId) return null;

  const tref = doc(db, "tenants", u.tenantId);
  const tsnap = await getDoc(tref);
  const t = tsnap.exists() ? tsnap.data() : { name: u.tenantId };

  return { tenantId: u.tenantId, role: u.role || "admin", tenantName: t.name || u.tenantId };
}

let ctx = null; // {tenantId, role, tenantName}
let currentDate = toISODate(new Date());

// UI init
$("filterDate").value = currentDate;

$("btnLogout").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "index.html";
});

$("btnRefresh").addEventListener("click", () => loadDay());

$("filterDate").addEventListener("change", () => {
  currentDate = $("filterDate").value;
  loadDay();
});

$("btnClear").addEventListener("click", () => {
  $("cliente").value = "";
  $("telefone").value = "";
  $("hora").value = "";
  $("servico").value = "";
  $("obs").value = "";
  setFormMsg("");
});

$("btnSave").addEventListener("click", async () => {
  if (!ctx) return;

  const cliente = $("cliente").value.trim();
  const telefone = onlyDigits($("telefone").value.trim());
  const data = $("filterDate").value;
  const hora = $("hora").value;
  const servico = $("servico").value.trim();
  const obs = $("obs").value.trim();

  if (!cliente || !telefone || !data || !hora) {
    setFormMsg("Preencha: Cliente, WhatsApp, Data e Hora.", "warn");
    return;
  }

  // documento em subcoleção do tenant
  const apptsRef = collection(db, "tenants", ctx.tenantId, "appointments");

  setFormMsg("Salvando…");

  try {
    await addDoc(apptsRef, {
      cliente,
      telefone,
      data,     // yyyy-mm-dd
      hora,     // HH:MM
      servico: servico || "Serviço",
      obs: obs || "",
      status: "PENDENTE",
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser.uid
    });

    setFormMsg("Agendamento criado ✅", "ok");
    $("btnClear").click();
    await loadDay();
  } catch (e) {
    setFormMsg("Erro ao salvar. Verifique as regras do Firestore.", "bad");
  }
});

async function toggleStatus(apptId, currentStatus) {
  if (!ctx) return;
  const ref = doc(db, "tenants", ctx.tenantId, "appointments", apptId);
  const next = currentStatus === "CONFIRMADO" ? "PENDENTE" : "CONFIRMADO";
  await updateDoc(ref, { status: next });
  await loadDay();
}

async function cancelAppt(apptId) {
  if (!ctx) return;
  const ref = doc(db, "tenants", ctx.tenantId, "appointments", apptId);
  await updateDoc(ref, { status: "CANCELADO" });
  await loadDay();
}

function render(appts) {
  // KPIs
  const total = appts.length;
  const conf = appts.filter(a => a.status === "CONFIRMADO").length;
  const pend = appts.filter(a => a.status === "PENDENTE").length;

  kpiTotal.textContent = String(total);
  kpiConfirmados.textContent = String(conf);
  kpiPendentes.textContent = String(pend);

  if (!total) {
    list.innerHTML = `<div class="msg">Nenhum agendamento nesta data.</div>`;
    return;
  }

  list.innerHTML = appts.map(a => {
    const badgeClass =
      a.status === "CONFIRMADO" ? "ok" :
      a.status === "CANCELADO" ? "bad" : "warn";

    const msgZap =
`Olá, ${a.cliente}! Seu horário está marcado para ${a.data} às ${a.hora} (${a.servico}).
Responda: 1️⃣ Confirmo | 2️⃣ Reagendar | 3️⃣ Cancelar`;

    const zapLink = makeWhatsAppLink(a.telefone, msgZap);

    return `
      <div class="item">
        <div class="meta">
          <div class="title">
            <span>${escapeHtml(a.hora)} • ${escapeHtml(a.cliente)}</span>
            <span class="badge ${badgeClass}" data-action="toggle" data-id="${a.id}" data-status="${a.status}">
              ${escapeHtml(a.status)}
            </span>
          </div>
          <div class="sub">
            ${escapeHtml(a.servico)} • WhatsApp: ${escapeHtml(a.telefone)} ${a.obs ? `• ${escapeHtml(a.obs)}` : ""}
          </div>
        </div>

        <div class="right">
          <div class="btns">
            <a class="link" href="${zapLink}" target="_blank" rel="noopener">WhatsApp</a>
            <button class="btn ghost" data-action="cancel" data-id="${a.id}" ${a.status==="CANCELADO" ? "disabled":""}>
              Cancelar
            </button>
          </div>
        </div>
      </div>
    `;
  }).join("");

  // bind actions
  list.querySelectorAll("[data-action='toggle']").forEach(el => {
    el.addEventListener("click", () => toggleStatus(el.dataset.id, el.dataset.status));
  });
  list.querySelectorAll("[data-action='cancel']").forEach(el => {
    el.addEventListener("click", () => cancelAppt(el.dataset.id));
  });
}

async function loadDay() {
  if (!ctx) return;

  const apptsRef = collection(db, "tenants", ctx.tenantId, "appointments");

  // Spark-friendly: filtra por data e ordena por hora
  const q = query(
    apptsRef,
    where("data", "==", currentDate),
    orderBy("hora", "asc")
  );

  list.innerHTML = `<div class="msg">Carregando…</div>`;

  try {
    const snap = await getDocs(q);
    const appts = [];
    snap.forEach(d => appts.push({ id: d.id, ...d.data() }));

    render(appts);
  } catch (e) {
    list.innerHTML = `<div class="msg bad">Erro ao carregar. Verifique índice/ordenação e regras.</div>`;
  }
}

// Auth guard + contexto do tenant
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  const c = await getUserContext(user.uid);
  if (!c) {
    tenantNameEl.textContent = "Sem tenant vinculado";
    list.innerHTML = `
      <div class="msg bad">
        Usuário sem tenant configurado. Crie o doc em <b>Firestore → users/${user.uid}</b> com <code>tenantId</code>.
      </div>
    `;
    return;
  }

  ctx = c;
  tenantNameEl.textContent = ctx.tenantName;
  await loadDay();
});

// Service Worker (PWA)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
