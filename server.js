import express from 'express';
import cookieSession from 'cookie-session';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { q, iniciarBase } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('escribir-a-la-vena:' + ADMIN_PASSWORD).digest('hex');

if (!ADMIN_PASSWORD) console.warn('Aviso: falta ADMIN_PASSWORD. El panel de administración quedará bloqueado.');

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(cookieSession({
  name: 'sesion',
  keys: [SESSION_SECRET],
  maxAge: 1000 * 60 * 60 * 24 * 14,
  sameSite: 'strict',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
}));

const subir = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

// ---------- utilidades ----------
const md = (texto = '') => sanitizeHtml(marked.parse(texto || '', { breaks: true }), {
  allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'blockquote', 'ul', 'ol', 'li', 'h2', 'h3', 'a', 'hr'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener' }) },
});
const slugify = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'sin-titulo';
const fechaLarga = (d) => d ? new Date(d).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
const lineas = (t = '') => t.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const i = l.indexOf(':');
  return i > 0 ? { k: l.slice(0, i).trim(), v: l.slice(i + 1).trim() } : { k: '', v: l };
});

async function slugUnico(tabla, base, id = null) {
  let slug = slugify(base), n = 2;
  while (true) {
    const r = await q(`SELECT id FROM ${tabla} WHERE slug=$1 AND ($2::int IS NULL OR id<>$2)`, [slug, id]);
    if (!r.rows.length) return slug;
    slug = `${slugify(base)}-${n++}`;
  }
}

async function guardarImagen(file) {
  if (!file) return null;
  const r = await q('INSERT INTO imagenes (mime, datos) VALUES ($1,$2) RETURNING id', [file.mimetype, file.buffer]);
  return r.rows[0].id;
}

app.use((req, res, next) => {
  res.locals.md = md;
  res.locals.fechaLarga = fechaLarga;
  res.locals.lineas = lineas;
  res.locals.ruta = req.path;
  res.locals.admin = !!req.session?.admin;
  next();
});

// ---------- salud (para el bot que mantiene despierto el sitio; no toca la base) ----------
app.get('/salud', (req, res) => res.type('text').send('ok'));

// ---------- imágenes ----------
app.get('/img/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.sendStatus(404);
  const r = await q('SELECT mime, datos FROM imagenes WHERE id=$1', [id]);
  if (!r.rows.length) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.type(r.rows[0].mime).send(r.rows[0].datos);
});

// ---------- sitio público ----------
app.get('/', async (req, res) => {
  const libros = (await q('SELECT * FROM libros WHERE visible ORDER BY orden, id')).rows;
  const cuentos = (await q('SELECT id,titulo,slug,bajada,imagen_id,fecha FROM cuentos WHERE publicado ORDER BY fecha DESC, id DESC LIMIT 3')).rows;
  res.render('inicio', { titulo: null, libros, cuentos });
});

app.get('/libros', async (req, res) => {
  const libros = (await q('SELECT * FROM libros WHERE visible ORDER BY orden, id')).rows;
  res.render('libros', { titulo: 'Libros', libros });
});

app.get('/libros/:slug', async (req, res, next) => {
  const r = await q('SELECT * FROM libros WHERE slug=$1 AND visible', [req.params.slug]);
  if (!r.rows.length) return next();
  res.render('libro', { titulo: r.rows[0].titulo, libro: r.rows[0] });
});

app.get('/cuentos', async (req, res) => {
  const cuentos = (await q('SELECT id,titulo,slug,bajada,imagen_id,fecha FROM cuentos WHERE publicado ORDER BY fecha DESC, id DESC')).rows;
  res.render('cuentos', { titulo: 'Cuentos', cuentos });
});

app.get('/cuentos/:slug', async (req, res, next) => {
  const r = await q('SELECT * FROM cuentos WHERE slug=$1 AND (publicado OR $2)', [req.params.slug, !!req.session?.admin]);
  if (!r.rows.length) return next();
  res.render('cuento', { titulo: r.rows[0].titulo, cuento: r.rows[0] });
});

for (const clave of ['sobre-mi', 'charlas', 'contacto']) {
  app.get('/' + clave, async (req, res) => {
    const r = await q('SELECT * FROM paginas WHERE clave=$1', [clave]);
    const pagina = r.rows[0] || { clave, titulo: clave, bajada: '', cuerpo: '' };
    res.render('pagina', { titulo: pagina.titulo, pagina });
  });
}

// ---------- administración ----------
const intentos = new Map();
const exigirAdmin = (req, res, next) => req.session?.admin ? next() : res.redirect('/admin/entrar');

app.get('/admin/entrar', (req, res) => res.render('admin/entrar', { titulo: 'Entrar', error: null }));

app.post('/admin/entrar', (req, res) => {
  const ip = req.ip;
  const reg = intentos.get(ip) || { n: 0, desde: Date.now() };
  if (Date.now() - reg.desde > 15 * 60 * 1000) { reg.n = 0; reg.desde = Date.now(); }
  if (reg.n >= 8) return res.status(429).render('admin/entrar', { titulo: 'Entrar', error: 'Demasiados intentos. Espera 15 minutos.' });
  const a = crypto.createHash('sha256').update(String(req.body.clave || '')).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (ADMIN_PASSWORD && crypto.timingSafeEqual(a, b)) {
    intentos.delete(ip);
    req.session.admin = true;
    return res.redirect('/admin');
  }
  reg.n++; intentos.set(ip, reg);
  res.status(401).render('admin/entrar', { titulo: 'Entrar', error: 'Contraseña incorrecta.' });
});

app.post('/admin/salir', (req, res) => { req.session = null; res.redirect('/'); });

app.get('/admin', exigirAdmin, async (req, res) => {
  const cuentos = (await q('SELECT id,titulo,slug,publicado,fecha FROM cuentos ORDER BY fecha DESC, id DESC')).rows;
  const libros = (await q('SELECT id,titulo,slug,visible,orden FROM libros ORDER BY orden, id')).rows;
  const paginas = (await q('SELECT clave,titulo FROM paginas ORDER BY clave')).rows;
  res.render('admin/panel', { titulo: 'Panel', cuentos, libros, paginas, aviso: req.query.ok || null });
});

// Cuentos
app.get('/admin/cuentos/nuevo', exigirAdmin, (req, res) =>
  res.render('admin/cuento', { titulo: 'Nuevo cuento', c: { id: null, titulo: '', bajada: '', cuerpo: '', publicado: false, fecha: new Date().toISOString().slice(0, 10), imagen_id: null } }));

app.get('/admin/cuentos/:id', exigirAdmin, async (req, res, next) => {
  const r = await q('SELECT * FROM cuentos WHERE id=$1', [parseInt(req.params.id, 10) || 0]);
  if (!r.rows.length) return next();
  const c = r.rows[0];
  c.fecha = c.fecha ? new Date(c.fecha).toISOString().slice(0, 10) : '';
  res.render('admin/cuento', { titulo: 'Editar cuento', c });
});

app.post('/admin/cuentos/guardar', exigirAdmin, subir.single('imagen'), async (req, res) => {
  const b = req.body;
  const id = parseInt(b.id, 10) || null;
  const titulo = (b.titulo || '').trim() || 'Sin título';
  const publicado = b.publicado === 'on';
  const fecha = b.fecha || new Date().toISOString().slice(0, 10);
  const nuevaImg = await guardarImagen(req.file);
  if (id) {
    const slug = await slugUnico('cuentos', titulo, id);
    await q(`UPDATE cuentos SET titulo=$1, slug=$2, bajada=$3, cuerpo=$4, publicado=$5, fecha=$6,
             imagen_id = CASE WHEN $7::int IS NOT NULL THEN $7 WHEN $8 THEN NULL ELSE imagen_id END WHERE id=$9`,
      [titulo, slug, b.bajada || '', b.cuerpo || '', publicado, fecha, nuevaImg, b.quitar_imagen === 'on', id]);
  } else {
    const slug = await slugUnico('cuentos', titulo);
    await q('INSERT INTO cuentos (titulo, slug, bajada, cuerpo, publicado, fecha, imagen_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [titulo, slug, b.bajada || '', b.cuerpo || '', publicado, fecha, nuevaImg]);
  }
  res.redirect('/admin?ok=' + encodeURIComponent(publicado ? 'Cuento guardado y publicado.' : 'Cuento guardado como borrador.'));
});

app.post('/admin/cuentos/:id/borrar', exigirAdmin, async (req, res) => {
  await q('DELETE FROM cuentos WHERE id=$1', [parseInt(req.params.id, 10) || 0]);
  res.redirect('/admin?ok=' + encodeURIComponent('Cuento borrado.'));
});

// Libros
app.get('/admin/libros/nuevo', exigirAdmin, (req, res) =>
  res.render('admin/libro', { titulo: 'Nuevo libro', l: { id: null, titulo: '', categoria: '', etiqueta: '', sinopsis: '', descripcion: '', cita: '', ficha: '', precio: '', boton_texto: 'Comprar', boton_enlace: '', color: '#1C1B19', orden: 10, visible: true, portada_id: null } }));

app.get('/admin/libros/:id', exigirAdmin, async (req, res, next) => {
  const r = await q('SELECT * FROM libros WHERE id=$1', [parseInt(req.params.id, 10) || 0]);
  if (!r.rows.length) return next();
  res.render('admin/libro', { titulo: 'Editar libro', l: r.rows[0] });
});

app.post('/admin/libros/guardar', exigirAdmin, subir.single('portada'), async (req, res) => {
  const b = req.body;
  const id = parseInt(b.id, 10) || null;
  const titulo = (b.titulo || '').trim() || 'Sin título';
  const color = /^#[0-9a-fA-F]{6}$/.test(b.color || '') ? b.color : '#1C1B19';
  const vals = [titulo, b.categoria || '', b.etiqueta || '', b.sinopsis || '', b.descripcion || '', b.cita || '', b.ficha || '',
    b.precio || '', b.boton_texto || 'Comprar', b.boton_enlace || '', color, parseInt(b.orden, 10) || 0, b.visible === 'on'];
  const nuevaImg = await guardarImagen(req.file);
  if (id) {
    const slug = await slugUnico('libros', titulo, id);
    await q(`UPDATE libros SET titulo=$1, categoria=$2, etiqueta=$3, sinopsis=$4, descripcion=$5, cita=$6, ficha=$7, precio=$8,
             boton_texto=$9, boton_enlace=$10, color=$11, orden=$12, visible=$13, slug=$14,
             portada_id = COALESCE($15, portada_id) WHERE id=$16`, [...vals, slug, nuevaImg, id]);
  } else {
    const slug = await slugUnico('libros', titulo);
    await q(`INSERT INTO libros (titulo, categoria, etiqueta, sinopsis, descripcion, cita, ficha, precio, boton_texto, boton_enlace, color, orden, visible, slug, portada_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [...vals, slug, nuevaImg]);
  }
  res.redirect('/admin?ok=' + encodeURIComponent('Libro guardado.'));
});

app.post('/admin/libros/:id/borrar', exigirAdmin, async (req, res) => {
  await q('DELETE FROM libros WHERE id=$1', [parseInt(req.params.id, 10) || 0]);
  res.redirect('/admin?ok=' + encodeURIComponent('Libro borrado.'));
});

// Páginas
app.get('/admin/paginas/:clave', exigirAdmin, async (req, res, next) => {
  const r = await q('SELECT * FROM paginas WHERE clave=$1', [req.params.clave]);
  if (!r.rows.length) return next();
  res.render('admin/pagina', { titulo: 'Editar página', p: r.rows[0] });
});

app.post('/admin/paginas/:clave', exigirAdmin, subir.single('imagen'), async (req, res) => {
  const b = req.body;
  const nuevaImg = await guardarImagen(req.file);
  await q(`UPDATE paginas SET titulo=$1, bajada=$2, cuerpo=$3,
           imagen_id = CASE WHEN $4::int IS NOT NULL THEN $4 WHEN $5 THEN NULL ELSE imagen_id END WHERE clave=$6`,
    [(b.titulo || '').trim() || 'Página', b.bajada || '', b.cuerpo || '', nuevaImg, b.quitar_imagen === 'on', req.params.clave]);
  res.redirect('/admin?ok=' + encodeURIComponent('Página guardada.'));
});

// ---------- errores ----------
app.use((req, res) => res.status(404).render('pagina', {
  titulo: 'No encontrado',
  pagina: { clave: '404', titulo: 'Esta página no existe', bajada: 'Puede que el enlace haya cambiado.', cuerpo: '[Volver al inicio](/)', imagen_id: null },
}));

app.use((err, req, res, next) => {
  console.error(err);
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'La imagen pesa más de 5 MB.' : 'Ocurrió un error. Intenta de nuevo.';
  res.status(500).render('pagina', { titulo: 'Error', pagina: { clave: 'error', titulo: 'Algo salió mal', bajada: msg, cuerpo: '[Volver](/)', imagen_id: null } });
});

iniciarBase()
  .then(() => app.listen(PORT, () => console.log(`Escribir a la vena escuchando en el puerto ${PORT}`)))
  .catch((e) => { console.error('No se pudo iniciar la base de datos:', e); process.exit(1); });
