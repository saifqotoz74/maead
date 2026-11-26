/* Minimal .xlsx reader. An .xlsx file is a zip of XML files. This reads the first sheet,
   entirely in the browser (DecompressionStream), with no library and no network. */
(function (root) {
  'use strict';

  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

  function zipEntries(b) {
    var eocd = -1, i;
    for (i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) { if (u32(b, i) === 0x06054b50) { eocd = i; break; } }
    if (eocd < 0) throw new Error('not_zip');
    var count = u16(b, eocd + 10), off = u32(b, eocd + 16), list = {};
    for (i = 0; i < count; i++) {
      if (u32(b, off) !== 0x02014b50) throw new Error('bad_zip');
      var method = u16(b, off + 10), csize = u32(b, off + 20), nlen = u16(b, off + 28), elen = u16(b, off + 30), clen = u16(b, off + 32), lho = u32(b, off + 42);
      var name = new TextDecoder().decode(b.subarray(off + 46, off + 46 + nlen));
      list[name] = { method: method, csize: csize, lho: lho };
      off += 46 + nlen + elen + clen;
    }
    return list;
  }

  async function entryBytes(b, e) {
    var lo = e.lho, start = lo + 30 + u16(b, lo + 26) + u16(b, lo + 28);
    var data = b.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method !== 8) throw new Error('zip_method');
    var ds = new DecompressionStream('deflate-raw');
    var w = ds.writable.getWriter(); w.write(data); w.close();
    return new Uint8Array(await new Response(ds.readable).arrayBuffer());
  }

  function unxml(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, function (m, g) {
      var k = g.toLowerCase();
      if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos') return "'";
      return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
    });
  }
  function textOf(xml) { var out = '', re = /<t[^>]*>([\s\S]*?)<\/t>/g, m; while ((m = re.exec(xml))) out += unxml(m[1]); return out; }

  function colIndex(ref) { var l = ref.replace(/[0-9]/g, ''), n = 0; for (var i = 0; i < l.length; i++) n = n * 26 + (l.charCodeAt(i) - 64); return n - 1; }

  function parseSheet(xml, shared) {
    var rows = [], reRow = /<row[^>]*>([\s\S]*?)<\/row>/g, rm;
    while ((rm = reRow.exec(xml))) {
      var row = [], reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, cm;
      while ((cm = reC.exec(rm[1]))) {
        var attrs = cm[1], body = cm[2] || '';
        var ref = /\br="([A-Z]+\d+)"/.exec(attrs), type = /\bt="(\w+)"/.exec(attrs);
        if (!ref) continue;
        var v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body), val = null;
        if (type && type[1] === 'inlineStr') val = textOf(body);
        else if (v) {
          if (type && type[1] === 's') val = shared[+v[1]] == null ? '' : shared[+v[1]];
          else if (type && (type[1] === 'str' || type[1] === 'e')) val = unxml(v[1]);
          else if (type && type[1] === 'b') val = v[1] === '1' ? 'TRUE' : 'FALSE';
          else val = { n: parseFloat(v[1]) };
        }
        row[colIndex(ref[1])] = val;
      }
      rows.push(row);
    }
    return rows;
  }

  async function readXlsx(buf) {
    var b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    var z = zipEntries(b);
    var shared = [];
    if (z['xl/sharedStrings.xml']) {
      var sx = new TextDecoder().decode(await entryBytes(b, z['xl/sharedStrings.xml'])), re = /<si\b[^>]*>([\s\S]*?)<\/si>/g, m;
      while ((m = re.exec(sx))) shared.push(textOf(m[1]));
    }
    var names = Object.keys(z).filter(function (n) { return /^xl\/worksheets\/sheet\d+\.xml$/.test(n); }).sort(function (a, c) { return parseInt(a.match(/\d+/)[0], 10) - parseInt(c.match(/\d+/)[0], 10); });
    if (!names.length) throw new Error('no_sheet');
    return parseSheet(new TextDecoder().decode(await entryBytes(b, z[names[0]])), shared);
  }

  function serialToDMY(n) {
    var d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
    return d.getUTCDate() + '/' + (d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  function fractionToHM(f) {
    var mins = Math.round((f % 1) * 1440), h = Math.floor(mins / 60) % 24, mi = mins % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mi < 10 ? '0' : '') + mi;
  }
  function clean(s) { return String(s).replace(/[\t\r\n]+/g, ' ').trim(); }

  /* cells -> tab-separated text the normal parser understands. mapHeader(h) returns 'date' | 'time' | 'phone' | ... */
  function toTSV(rows, mapHeader) {
    var rs = rows.filter(function (r) { return r && r.some(function (c) { return c != null && String(c.n != null ? c.n : c).trim() !== ''; }); });
    if (!rs.length) return '';
    var head = (rs[0] || []).map(function (c) { return c == null ? '' : (c.n != null ? String(c.n) : String(c)); });
    var kinds = head.map(function (h) { return mapHeader ? mapHeader(h) : null; });
    var width = head.length;
    rs.forEach(function (r) { if (r.length > width) width = r.length; });
    var out = rs.map(function (r, ri) {
      var cells = [];
      for (var i = 0; i < width; i++) {
        var c = r[i];
        if (c == null) { cells.push(''); continue; }
        if (c.n != null) {
          var k = kinds[i];
          if (ri > 0 && k === 'date' && c.n > 20000) cells.push(serialToDMY(c.n));
          else if (ri > 0 && k === 'time' && c.n >= 0 && c.n < 1) cells.push(fractionToHM(c.n));
          else if (ri > 0 && k === 'time' && c.n >= 20000) cells.push(fractionToHM(c.n));
          else if (ri > 0 && k === 'phone') { var s = String(Math.round(c.n)); cells.push(s.length === 10 ? '0' + s : s); }
          else cells.push(String(c.n));
        } else cells.push(clean(c));
      }
      return cells.join('\t');
    });
    return out.join('\n');
  }

  var api = { readXlsx: readXlsx, toTSV: toTSV, zipEntries: zipEntries };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MaeadXlsx = api;
})(typeof self !== 'undefined' ? self : this);
