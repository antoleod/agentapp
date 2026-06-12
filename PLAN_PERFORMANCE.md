# Plan de Optimización de Carga de Datos

## Problema actual

`getData()` en `core.js:144` descarga **todos** los documentos de Firestore sin límite cada vez que se carga la página:

```js
const snap = await window.db.collection(COLLECTION)
  .orderBy("createdAt", "desc")
  .get();  // ← sin límite, descarga TODO
```

Con 1,000+ evaluaciones esto es lento, costoso en lecturas de Firestore, y usa localStorage (límite ~5 MB).

---

## Estrategias a implementar (combinadas)

### 1. Sync incremental (`core.js`)

**Objetivo:** Después del primer login solo descargar registros nuevos o modificados.

**Cómo funciona:**
- Guardar `lastSyncedAt` (timestamp ISO) en localStorage bajo `SYNC_KEY = "agentSyncMetaV1"`
- Primera carga (sin cache): descarga completa con `.limit(1000)` → guarda `lastSyncedAt`
- Cargas siguientes: consulta solo `where updatedAt > lastSyncedAt` → fusiona con cache
- El botón "Refresh" fuerza sync completo (`forceFullSync: true`)

**Limitación conocida:** Las eliminaciones hechas por otros usuarios no se detectan en sync incremental. Se resuelve con el listener `onSnapshot` (ver punto 3).

**Cambios en `core.js`:**
```
+ const SYNC_KEY = "agentSyncMetaV1";

  async function getData(opts = {}) {
+   const { forceFullSync = false } = opts;
+   const syncMeta = JSON.parse(localStorage.getItem(SYNC_KEY) || "{}");
+   const cached   = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

+   if (!forceFullSync && cached.length && syncMeta.lastSyncedAt) {
+     // Incremental: solo registros modificados después de lastSyncedAt
+     const since = firebase.firestore.Timestamp.fromDate(new Date(syncMeta.lastSyncedAt));
+     const snap  = await window.db.collection(COLLECTION)
+       .where("updatedAt", ">", since)
+       .orderBy("updatedAt", "desc")
+       .get();
+     if (snap.empty) return cached;
+     // Merge: nuevos/actualizados sobreescriben cache
+     const map = new Map(cached.map(x => [x.ticketNumber, x]));
+     snap.docs.forEach(d => map.set(d.id, d.data()));
+     const merged = [...map.values()].sort((a, b) =>
+       (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
+     localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
+     localStorage.setItem(SYNC_KEY, JSON.stringify({ lastSyncedAt: new Date().toISOString() }));
+     return merged;
+   }

    // Full sync (primera vez o forzado)
    const snap = await window.db.collection(COLLECTION)
      .orderBy("createdAt", "desc")
+     .limit(1000)
      .get();
    const data = snap.docs.map(d => d.data());
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
+   localStorage.setItem(SYNC_KEY, JSON.stringify({ lastSyncedAt: new Date().toISOString() }));
    return data;
  }
```

---

### 2. Límite inicial de 1,000 registros (`core.js`)

**Objetivo:** Limitar la cantidad de documentos en el full sync para evitar descargas masivas.

- `.limit(1000)` en el full sync (ya incluido arriba)
- Mostrar en UI: "Mostrando los 1,000 registros más recientes" si `data.length === 1000`
- El sync incremental añade registros nuevos encima sin límite artificial

---

### 3. Listener `onSnapshot` para cambios en tiempo real (`core.js` + páginas)

**Objetivo:** Recibir actualizaciones de otros usuarios sin hacer polls manuales.

**Cómo funciona:**
- `subscribeData(callback)` abre un listener de Firestore sobre los 50 documentos más recientemente modificados
- Firestore envía solo los **deltas** (`docChanges`): `added`, `modified`, `removed`
- El callback actualiza el cache local y re-renderiza la UI

**Nueva función en `core.js`:**
```js
let _unsubscribeSnapshot = null;

function subscribeData(callback) {
  if (_unsubscribeSnapshot) _unsubscribeSnapshot(); // limpia listener anterior
  if (sessionStorage.getItem("guestSession") === "1") return;

  _unsubscribeSnapshot = window.db.collection(COLLECTION)
    .orderBy("updatedAt", "desc")
    .limit(50)
    .onSnapshot({ includeMetadataChanges: false }, snap => {
      const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      let changed = false;

      snap.docChanges().forEach(change => {
        const doc = change.doc.data();
        const key = change.doc.id;
        if (change.type === "added" || change.type === "modified") {
          const idx = cached.findIndex(x => x.ticketNumber === key);
          if (idx >= 0) cached[idx] = doc; else cached.unshift(doc);
          changed = true;
        } else if (change.type === "removed") {
          const idx = cached.findIndex(x => x.ticketNumber === key);
          if (idx >= 0) { cached.splice(idx, 1); changed = true; }
        }
      });

      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cached));
        callback(cached);
      }
    }, () => {}); // error silencioso — fallback al cache
}

function unsubscribeData() {
  if (_unsubscribeSnapshot) { _unsubscribeSnapshot(); _unsubscribeSnapshot = null; }
}
```

---

### 4. Cambios en `database.js`

- Al entrar a la página: mostrar cache → lanzar `getData()` incremental en background → luego `subscribeData()`
- Botón "Refresh": llamar `getData({ forceFullSync: true })`
- Al salir (visibilitychange / beforeunload): llamar `unsubscribeData()`

```js
document.addEventListener("appReady", async () => {
  // 1. Cache inmediato
  const cached = isGuest ? [] : JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  if (cached.length) { allData = cached; renderTable(allData); }
  else setTableLoading(true);

  bindEvents(); bindImportPreview(); bindAuditModal();

  // 2. Sync incremental en background
  try {
    const fresh = await getData();
    if (JSON.stringify(fresh) !== JSON.stringify(allData)) {
      allData = fresh; renderTable(allData);
    }
  } catch (err) {
    if (!cached.length) toast("Failed to load data: " + err.message, "error");
  } finally {
    setTableLoading(false);
  }

  // 3. Listener tiempo real
  subscribeData(data => { allData = data; renderTable(allData); });
});

// Limpiar listener al salir
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") unsubscribeData();
});
```

---

### 5. Cambios en `reports.js`

- Igual que database.js: cache → sync incremental → `subscribeData()`
- Botón "Refresh" → `getData({ forceFullSync: true })`

---

## Seguridad

| Riesgo | Mitigación |
|--------|------------|
| Datos en localStorage | Solo accesibles por el mismo origen (same-origin policy). No se comparten entre usuarios. |
| Guests | `sessionStorage.getItem("guestSession") === "1"` → cache siempre vacío, sin listener |
| Listener activo en background | Se destruye con `unsubscribeData()` al cambiar de pestaña / cerrar |
| Datos stale por limite 1000 | El sync incremental añade registros nuevos sin límite; solo el full sync está limitado |

---

## Orden de implementación

1. [ ] `core.js` — modificar `getData()` con sync incremental + limit(1000) + guardar `SYNC_KEY`
2. [ ] `core.js` — agregar `subscribeData()` y `unsubscribeData()`
3. [ ] `database.js` — integrar `subscribeData` + forzar full sync en botón Refresh
4. [ ] `reports.js` — misma integración que database.js
5. [ ] (Opcional) Mostrar toast/badge si `data.length === 1000` ("Mostrando los 1,000 más recientes")

---

## Resultado esperado

| Escenario | Antes | Después |
|-----------|-------|---------|
| Primera carga (sin cache) | Descarga todos | Descarga max 1,000 |
| Segunda carga | Descarga todos | Solo cambios desde último sync |
| Cambios de otro usuario | Solo al recargar | Tiempo real via onSnapshot |
| Memoria localStorage | Crece sin límite | Máximo ~1,000 registros |
