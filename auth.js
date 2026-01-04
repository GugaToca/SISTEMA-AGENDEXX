// js/auth.js
import { firebaseConfig } from ".firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const $ = (id) => document.getElementById(id);
const msg = $("msg");

function setMsg(text, type="") {
  msg.className = "msg " + type;
  msg.textContent = text || "";
}

$("btnLogin").addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;

  if (!email || !password) {
    setMsg("Preencha email e senha.", "warn");
    return;
  }

  setMsg("Entrando…");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "app.html";
  } catch (e) {
    setMsg("Falha no login. Verifique email/senha.", "bad");
  }
});

$("btnReset").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email) {
    setMsg("Digite seu email para redefinir a senha.", "warn");
    return;
  }
  setMsg("Enviando email de redefinição…");
  try {
    await sendPasswordResetEmail(auth, email);
    setMsg("Email enviado! Verifique sua caixa de entrada.", "ok");
  } catch (e) {
    setMsg("Não foi possível enviar. Confira o email.", "bad");
  }
});

// Service Worker (PWA)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
