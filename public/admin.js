/* Editor de texto con formato para el panel de "Escribir a la vena" (usa Quill) */
(function () {
  var cont = document.getElementById('editor');
  if (!cont || !window.Quill) return;

  var iconos = Quill.import('ui/icons');
  iconos.undo = '<svg viewBox="0 0 18 18"><polygon class="ql-fill ql-stroke" points="6 10 4 12 2 10 6 10"></polygon><path class="ql-stroke" d="M8.09,13.91A4.6,4.6,0,0,0,9,14,5,5,0,1,0,4,9"></path></svg>';
  iconos.redo = '<svg viewBox="0 0 18 18"><polygon class="ql-fill ql-stroke" points="12 10 14 12 16 10 12 10"></polygon><path class="ql-stroke" d="M9.91,13.91A4.6,4.6,0,0,1,9,14a5,5,0,1,1,5-5"></path></svg>';

  function subirImagen() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,image/gif';
    input.onchange = function () {
      var archivo = input.files && input.files[0];
      if (!archivo) return;
      var datos = new FormData();
      datos.append('imagen', archivo);
      estado('Subiendo imagen…');
      fetch('/admin/imagenes', { method: 'POST', body: datos, credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (!j.url) throw new Error(j.error || 'No se pudo subir la imagen.');
          var rango = quill.getSelection(true);
          quill.insertEmbed(rango.index, 'image', j.url, 'user');
          quill.setSelection(rango.index + 1, 0);
          estado('Imagen agregada.');
        })
        .catch(function (e) { estado(e.message, true); });
    };
    input.click();
  }

  var quill = new Quill(cont, {
    theme: 'snow',
    placeholder: cont.getAttribute('data-placeholder') || 'Escribe aquí…',
    modules: {
      history: { delay: 800, maxStack: 200, userOnly: true },
      toolbar: {
        container: [
          ['bold', 'italic', 'underline', 'strike'],
          [{ header: 2 }, { header: 3 }],
          [{ list: 'bullet' }, { list: 'ordered' }, 'blockquote'],
          [{ align: '' }, { align: 'center' }, { align: 'right' }, { align: 'justify' }],
          ['link', 'image', 'video'],
          ['undo', 'redo'],
          ['clean'],
        ],
        handlers: {
          image: subirImagen,
          undo: function () { quill.history.undo(); },
          redo: function () { quill.history.redo(); },
        },
      },
    },
  });

  // Nombres en español al pasar el mouse por los botones
  var nombres = {
    'ql-bold': 'Negrita', 'ql-italic': 'Cursiva', 'ql-underline': 'Subrayado', 'ql-strike': 'Tachado',
    'ql-blockquote': 'Cita', 'ql-link': 'Enlace', 'ql-image': 'Imagen', 'ql-video': 'Video de YouTube',
    'ql-undo': 'Deshacer', 'ql-redo': 'Rehacer', 'ql-clean': 'Quitar formato',
  };
  document.querySelectorAll('.ql-toolbar button').forEach(function (b) {
    var c = b.className.split(' ')[0];
    var v = b.value;
    var t = nombres[c];
    if (c === 'ql-header') t = v === '2' ? 'Título' : 'Subtítulo';
    if (c === 'ql-list') t = v === 'bullet' ? 'Lista con viñetas' : 'Lista numerada';
    if (c === 'ql-align') t = { '': 'Alinear a la izquierda', center: 'Centrar', right: 'Alinear a la derecha', justify: 'Justificar' }[v || ''];
    if (t) { b.title = t; b.setAttribute('aria-label', t); }
  });

  var contador = document.getElementById('contador');
  var avisoEl = document.getElementById('estado-editor');
  function estado(msg, error) {
    if (!avisoEl) return;
    avisoEl.textContent = msg;
    avisoEl.style.color = error ? '#8E2219' : '#0B5C3E';
  }
  function contar() {
    if (!contador) return;
    var texto = quill.getText().trim();
    var palabras = texto ? texto.split(/\s+/).length : 0;
    var min = Math.max(1, Math.round(palabras / 200));
    contador.textContent = palabras.toLocaleString('es-CL') + ' palabras · ' + min + ' min de lectura';
  }
  quill.on('text-change', contar);
  contar();

  // Al guardar, el contenido del editor viaja en el campo oculto "cuerpo"
  var form = cont.closest('form');
  var oculto = form.querySelector('input[name="cuerpo"]');
  form.addEventListener('submit', function () {
    var html = quill.getText().trim().length || quill.root.querySelector('img,iframe') ? quill.getSemanticHTML() : '';
    // Quill entrega los videos como enlaces; los volvemos a convertir en video incrustado
    var tmp = document.createElement('div');
    tmp.innerHTML = html.replace(/&nbsp;/g, ' ');
    tmp.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (/^https:\/\/(www\.youtube(-nocookie)?\.com\/embed\/|player\.vimeo\.com\/video\/)/.test(href) && a.textContent.trim() === href) {
        var f = document.createElement('iframe');
        f.className = 'ql-video';
        f.setAttribute('src', href);
        f.setAttribute('frameborder', '0');
        f.setAttribute('allowfullscreen', 'true');
        a.replaceWith(f);
      }
    });
    oculto.value = tmp.innerHTML;
  });
})();
