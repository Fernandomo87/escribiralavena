import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error('Falta la variable DATABASE_URL (dirección de conexión de la base de datos).');
  process.exit(1);
}

const usaSSL = !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: usaSSL ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
});

export const q = (text, params) => pool.query(text, params);

export async function iniciarBase() {
  await q(`
    CREATE TABLE IF NOT EXISTS imagenes (
      id SERIAL PRIMARY KEY,
      mime TEXT NOT NULL,
      datos BYTEA NOT NULL,
      creada TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS libros (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      categoria TEXT DEFAULT '',
      etiqueta TEXT DEFAULT '',
      sinopsis TEXT DEFAULT '',
      descripcion TEXT DEFAULT '',
      cita TEXT DEFAULT '',
      ficha TEXT DEFAULT '',
      precio TEXT DEFAULT '',
      boton_texto TEXT DEFAULT 'Comprar',
      boton_enlace TEXT DEFAULT '',
      color TEXT DEFAULT '#1C1B19',
      portada_id INTEGER REFERENCES imagenes(id) ON DELETE SET NULL,
      orden INTEGER DEFAULT 0,
      visible BOOLEAN DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS cuentos (
      id SERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      bajada TEXT DEFAULT '',
      cuerpo TEXT DEFAULT '',
      imagen_id INTEGER REFERENCES imagenes(id) ON DELETE SET NULL,
      publicado BOOLEAN DEFAULT false,
      fecha DATE DEFAULT CURRENT_DATE,
      creado TIMESTAMPTZ DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS paginas (
      clave TEXT PRIMARY KEY,
      titulo TEXT NOT NULL,
      bajada TEXT DEFAULT '',
      cuerpo TEXT DEFAULT '',
      imagen_id INTEGER REFERENCES imagenes(id) ON DELETE SET NULL
    );
  `);

  // Versión 2: editor con formato (HTML) y contador de vistas
  await q(`
    ALTER TABLE cuentos ADD COLUMN IF NOT EXISTS formato TEXT DEFAULT 'md';
    ALTER TABLE paginas ADD COLUMN IF NOT EXISTS formato TEXT DEFAULT 'md';
    ALTER TABLE libros ADD COLUMN IF NOT EXISTS adelanto_titulo TEXT DEFAULT '';
    ALTER TABLE libros ADD COLUMN IF NOT EXISTS adelanto TEXT DEFAULT '';
    CREATE TABLE IF NOT EXISTS vistas (
      id BIGSERIAL PRIMARY KEY,
      dia DATE NOT NULL DEFAULT (now() AT TIME ZONE 'America/Santiago')::date,
      ruta TEXT NOT NULL,
      cuento_id INTEGER REFERENCES cuentos(id) ON DELETE SET NULL,
      visitante TEXT NOT NULL,
      creada TIMESTAMPTZ DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS vistas_dia_idx ON vistas (dia);
    CREATE INDEX IF NOT EXISTS vistas_cuento_idx ON vistas (cuento_id);
  `);

  const { rows } = await q('SELECT count(*)::int AS n FROM libros');
  if (rows[0].n === 0) await sembrar();
}

async function guardarImagenArchivo(nombre, mime) {
  const datos = fs.readFileSync(path.join(__dirname, 'seed', nombre));
  const r = await q('INSERT INTO imagenes (mime, datos) VALUES ($1, $2) RETURNING id', [mime, datos]);
  return r.rows[0].id;
}

async function sembrar() {
  console.log('Base vacía: cargando contenido inicial…');
  const pCuentos = await guardarImagenArchivo('cuentos-a-la-vena.jpg', 'image/jpeg');
  const pRefranario = await guardarImagenArchivo('refranario.jpg', 'image/jpeg');

  await q(
    `INSERT INTO libros (titulo, slug, categoria, etiqueta, sinopsis, descripcion, cita, ficha, precio, boton_texto, boton_enlace, color, portada_id, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1)`,
    [
      'Cuentos a la vena', 'cuentos-a-la-vena', 'Cuentos · Ondemand Ediciones', '',
      'Veintidós cuentos escritos en veinte años, todos premiados o destacados en concursos literarios. Abuso doméstico, abandono institucional, violencia estructural: personajes atrapados, pero tercos y luminosos. Sin finales edulcorados.',
      'Esta selección reúne veintidós cuentos escritos a lo largo de veinte años, todos reconocidos en concursos literarios de cuento breve.\n\nSon relatos de lectura ágil y directa que miran lo que suele barrerse bajo la alfombra: el abuso doméstico, el abandono institucional, la violencia estructural. Sus personajes, muchas veces atrapados, son también fraternos, tercos y luminosos, y enfrentan el absurdo de la existencia con ternura, humor y crítica.\n\nAquí no hay redención garantizada ni finales edulcorados.',
      'Cuentos que entran directo… a la vena.',
      'Editorial: Ondemand Ediciones\nAño: 2025\nISBN: 9789566287933\nEncuadernación: tapa blanda',
      '$10.000', 'Comprar en Buscalibre',
      'https://www.buscalibre.cl/libro-cuento-a-la-vena/9789566287933/p/67228181',
      '#1C1B19', pCuentos,
    ]
  );
  await q(
    `INSERT INTO libros (titulo, slug, categoria, etiqueta, sinopsis, descripcion, cita, ficha, precio, boton_texto, boton_enlace, color, portada_id, orden)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,2)`,
    [
      'Refranario del buen director escolar', 'refranario-del-buen-director-escolar', 'Liderazgo escolar · Berilio Ediciones', 'Segunda edición',
      'Dirigir una escuela también es un oficio, y como todo oficio tiene sus reglas. Este libro las reúne a partir de refranes populares: lo que conviene hacer, lo que conviene evitar y lo que enseña la experiencia. Edición ampliada, con más refranes y reglas de oficio.',
      'Dirigir una escuela también es un oficio, y como todo oficio tiene sus reglas. Este libro las reúne a partir de refranes populares: lo que conviene hacer, lo que conviene evitar y lo que enseña la experiencia de estar al frente de una escuela.\n\nEsta segunda edición viene ampliada, con más refranes y reglas de oficio.',
      'Lo importante no es el director: es la escuela que queda cuando el director ya no está.',
      'Editorial: Berilio Ediciones\nEdición: segunda, ampliada (noviembre 2026)\nFormato: A5',
      'Preventa $12.000', 'Reservar por Instagram',
      'https://ig.me/m/escribir.a.la.vena',
      '#0F6B63', pRefranario,
    ]
  );

  await q(
    `INSERT INTO paginas (clave, titulo, bajada, cuerpo) VALUES
     ('sobre-mi', 'Sobre mí', 'Profesor de castellano, director de escuela y escritor.', $1),
     ('charlas', 'Charlas para equipos directivos', 'Conversaciones a partir del Refranario del buen director escolar.', $2),
     ('contacto', 'Contacto', 'Para pedidos, presentaciones de libros, charlas o comentar un cuento.', $3)
     ON CONFLICT (clave) DO NOTHING`,
    [
      'Escribe aquí tu historia. Este texto se edita desde el panel de administración, en **Páginas › Sobre mí**.',
      'Describe aquí las charlas que ofreces: a quién están dirigidas, qué temas tocan y cómo se coordinan. Este texto se edita desde el panel, en **Páginas › Charlas**.',
      'Escríbeme por Instagram a **@escribir.a.la.vena**. Este texto se edita desde el panel, en **Páginas › Contacto**.',
    ]
  );
  console.log('Contenido inicial cargado.');
}
