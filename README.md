# Escribir a la vena

Sitio web de Fernando Muñoz O. con panel de administración (`/admin`).

- Servidor: Node.js + Express, en Render (Web Service).
- Base de datos: PostgreSQL en Neon (cuentos, libros, páginas e imágenes).

## Variables de entorno (en Render)

- `DATABASE_URL`: dirección de conexión de la base de datos de Neon.
- `ADMIN_PASSWORD`: contraseña del panel de administración.
- `NODE_ENV`: `production`.

## Comandos en Render

- Build: `npm install`
- Start: `npm start`
