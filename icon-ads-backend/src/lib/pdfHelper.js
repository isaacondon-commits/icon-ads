const PDFDocument = require('pdfkit');

const BLUE = '#1d4ed8';
const GRAY = '#6b7280';
const LIGHT = '#f3f4f6';
const BLACK = '#111827';

function createDoc() {
  return new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
}

function header(doc, title, subtitle = '') {
  doc.rect(0, 0, doc.page.width, 80).fill(BLUE);
  doc.fillColor('white').fontSize(22).font('Helvetica-Bold').text('ICON ADS', 50, 24);
  doc.fontSize(9).font('Helvetica').text('Publicidad digital en taxi', 50, 50);
  doc.fillColor(BLACK).fontSize(16).font('Helvetica-Bold').text(title, 50, 100);
  if (subtitle) doc.fontSize(10).font('Helvetica').fillColor(GRAY).text(subtitle, 50, 122);
  doc.moveDown(subtitle ? 2 : 2.5);
}

function divider(doc) {
  doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor('#e5e7eb').stroke();
  doc.moveDown(0.5);
}

function sectionTitle(doc, text) {
  doc.moveDown(0.5);
  doc.fontSize(9).font('Helvetica-Bold').fillColor(GRAY).text(text.toUpperCase(), 50);
  divider(doc);
  doc.fontSize(10).font('Helvetica').fillColor(BLACK);
}

function row(doc, label, value, highlight = false) {
  const y = doc.y;
  doc.fontSize(9).font('Helvetica').fillColor(GRAY).text(label, 50, y, { width: 180 });
  doc.fontSize(9).font(highlight ? 'Helvetica-Bold' : 'Helvetica').fillColor(BLACK).text(String(value), 230, y);
  doc.moveDown(0.4);
}

function footer(doc) {
  const bottom = doc.page.height - 40;
  doc.fontSize(8).font('Helvetica').fillColor(GRAY)
    .text(`ICON ADS — Generado el ${new Date().toLocaleString('es-AR')} — Documento generado automáticamente`, 50, bottom, { align: 'center', width: doc.page.width - 100 });
}

function bufferize(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('es-AR') : '—';
}

module.exports = { createDoc, header, divider, sectionTitle, row, footer, bufferize, fmtDate, BLUE, GRAY, LIGHT, BLACK };
