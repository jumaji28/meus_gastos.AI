/* Service worker do Meus Gastos.AI.
   1) Recebe os arquivos do botão "Compartilhar" do Android (share_target do manifesto): guarda no cache
      "mg-compartilhados" e abre o app em /?compartilhado=1, que importa e apaga.
   2) Deixa o app abrir sem internet: a página vem sempre da rede quando há conexão (pega a versão nova)
      e do cache quando não há. Bibliotecas do cdnjs e fontes ficam em cache depois do primeiro uso.
   3) Mostra os avisos (Web Push) mandados pela função "avisos" do Supabase, para quem ativou em Enviar extratos › Seus dados.
      Tocar no aviso abre o app no endereço que veio junto (ex.: /?novo=1 abre o "Novo lançamento").
   Os extratos nunca saem do aparelho: tudo acontece aqui dentro. */
const VERSAO = 'mg-v3';
const ESTATICOS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ESTATICOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO && k !== 'mg-compartilhados').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function receberCompartilhado(req) {
  try {
    const form = await req.formData();
    const cache = await caches.open('mg-compartilhados');
    let i = 0;
    for (const f of form.getAll('arquivos')) {
      if (!f || typeof f === 'string') continue;
      await cache.put(`/compartilhado/${Date.now()}-${i++}`, new Response(f, {
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nome': encodeURIComponent(f.name || `arquivo-${i}`) },
      }));
    }
    return Response.redirect(`/?compartilhado=${i}`, 303);
  } catch {
    return Response.redirect('/?compartilhado=erro', 303);
  }
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname === '/compartilhar') { e.respondWith(receberCompartilhado(req)); return; }
  if (req.method !== 'GET') return;
  // página: rede primeiro, cache se estiver sem internet
  if (req.mode === 'navigate') {
    // cache: 'no-cache' = sempre confere com o servidor, para ninguém ficar preso numa versão antiga
    e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => { const c = r.clone(); caches.open(VERSAO).then(k => k.put('/', c)); return r; })
      .catch(() => caches.match('/').then(r => r || caches.match(req))));
    return;
  }
  // bibliotecas e fontes de fora: cache primeiro (as URLs têm versão fixa)
  if (/cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { if (res.ok || res.type === 'opaque') { const c = res.clone(); caches.open(VERSAO).then(k => k.put(req, c)); } return res; })));
    return;
  }
  if (url.origin === location.origin) e.respondWith(fetch(req).catch(() => caches.match(req)));
});

self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { texto: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Meus Gastos', {
    body: d.texto || '', icon: '/icon-192.png', badge: '/icon-192.png', lang: 'pt-BR', data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  // só endereços do próprio app
  const alvo = new URL(/^\/(?!\/)/.test(e.notification.data && e.notification.data.url) ? e.notification.data.url : '/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(janelas => {
    const j = janelas.find(c => new URL(c.url).origin === location.origin);
    return j ? j.navigate(alvo).then(c => (c || j).focus()) : self.clients.openWindow(alvo);
  }));
});
