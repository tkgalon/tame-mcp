// Writes two fictional CTF write-ups in a style far from the owner's, used as Profile A in the Fase 6 test
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";
import { deflateSync } from "node:zlib";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const OUT = new URL("./out/", import.meta.url);
const NAVY = rgb(0.12, 0.22, 0.39);
const SKY = rgb(0.91, 0.95, 0.99);
const STRIPE = rgb(0.95, 0.95, 0.95);
const GRAY = rgb(0.4, 0.4, 0.4);
const CODE = rgb(0.12, 0.12, 0.12);
const MINT = rgb(0.9, 0.96, 0.92);
const GREEN = rgb(0.13, 0.5, 0.26);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0.1, 0.1, 0.1);

// A flat dark PNG with a few light bars, standing in for a terminal screenshot
function screenshotPng(width, height, seed) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const bar = y % 14 < 6 && x > 12 && x < 12 + ((y * 7 + seed * 31) % (width - 40));
      const value = bar ? 200 : 32;
      row.fill(value, 1 + x * 3, 4 + x * 3);
    }
    rows.push(row);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function writeup(spec) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const left = 56;
  const right = 539;
  const width = right - left;
  let page;
  let y = 0;
  let figure = 0;

  const newPage = () => {
    page = pdf.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 806, width: 595, height: 36, color: NAVY });
    page.drawText(`WRITE-UP CTF  |  ${spec.author}`, { x: left, y: 819, size: 9, font: bold, color: WHITE });
    const code = spec.code;
    page.drawText(code, {
      x: right - bold.widthOfTextAtSize(code, 9),
      y: 819,
      size: 9,
      font: bold,
      color: WHITE,
    });
    y = 780;
  };
  const ensure = (height) => {
    if (y - height < 70) newPage();
  };
  const lines = (text, font, size, maxWidth) => {
    const result = [];
    let line = [];
    for (const word of text.split(" ")) {
      const next = [...line, word].join(" ");
      if (line.length && font.widthOfTextAtSize(next, size) > maxWidth) {
        result.push(line);
        line = [word];
      } else line.push(word);
    }
    if (line.length) result.push(line);
    return result;
  };
  // Justified paragraphs place each word, so every full line reaches the right margin
  const paragraph = (
    text,
    { font = regular, size = 10.5, color = BLACK, x = left, w = width, gap = 6 } = {},
  ) => {
    const wrapped = lines(text, font, size, w);
    for (const [index, words] of wrapped.entries()) {
      ensure(size + 4);
      const last = index === wrapped.length - 1;
      const used = words.reduce((sum, word) => sum + font.widthOfTextAtSize(word, size), 0);
      const space =
        last || words.length === 1 ? font.widthOfTextAtSize(" ", size) : (w - used) / (words.length - 1);
      let cursor = x;
      for (const word of words) {
        page.drawText(word, { x: cursor, y, size, font, color });
        cursor += font.widthOfTextAtSize(word, size) + space;
      }
      y -= size + 4;
    }
    y -= gap;
  };
  const heading = (text) => {
    ensure(40);
    y -= 6;
    page.drawText(text.toUpperCase(), { x: left, y, size: 12, font: bold, color: NAVY });
    page.drawLine({ start: { x: left, y: y - 5 }, end: { x: right, y: y - 5 }, thickness: 1.2, color: NAVY });
    y -= 24;
  };
  const table = (columns, rows) => {
    const rowHeight = 18;
    ensure(rowHeight * (rows.length + 1) + 10);
    const widths = columns.map((column) => column.width * width);
    const drawRow = (cells, fill, font, color) => {
      page.drawRectangle({ x: left, y: y - 5, width, height: rowHeight, color: fill });
      let cursor = left + 6;
      cells.forEach((cell, index) => {
        page.drawText(String(cell), { x: cursor, y, size: 9.5, font, color });
        cursor += widths[index];
      });
      y -= rowHeight;
    };
    drawRow(
      columns.map((column) => column.label),
      NAVY,
      bold,
      WHITE,
    );
    rows.forEach((cells, index) => drawRow(cells, index % 2 ? STRIPE : WHITE, regular, BLACK));
    page.drawRectangle({
      x: left,
      y: y + 13,
      width,
      height: rowHeight * (rows.length + 1),
      borderColor: GRAY,
      borderWidth: 0.6,
    });
    y -= 12;
  };
  const command = (text) => {
    const height = text.split("\n").length * 12 + 12;
    ensure(height + 8);
    page.drawRectangle({ x: left, y: y - height + 14, width, height, color: CODE });
    text.split("\n").forEach((line, index) => {
      page.drawText(line, { x: left + 10, y: y - index * 12, size: 9, font: mono, color: WHITE });
    });
    y -= height + 6;
  };
  const screenshot = async (caption, seed) => {
    const image = await pdf.embedPng(screenshotPng(480, 150, seed));
    ensure(170);
    page.drawImage(image, { x: left, y: y - 124, width: 380, height: 120 });
    y -= 138;
    page.drawText(`Gambar ${++figure}. ${caption}`, { x: left, y, size: 8.5, font: italic, color: GRAY });
    y -= 20;
  };
  const question = async (number, item) => {
    const wrapped = lines(item.question, bold, 10.5, width - 24);
    const height = 22 + wrapped.length * 14;
    ensure(height + 80);
    page.drawRectangle({ x: left, y: y - height + 16, width, height, color: SKY });
    page.drawRectangle({ x: left, y: y - height + 16, width: 4, height, color: NAVY });
    page.drawText(`PERTANYAAN ${number}`, { x: left + 14, y, size: 8.5, font: bold, color: NAVY });
    y -= 16;
    for (const words of wrapped) {
      page.drawText(words.join(" "), { x: left + 14, y, size: 10.5, font: bold, color: BLACK });
      y -= 14;
    }
    y -= 14;
    paragraph(item.analysis);
    if (item.command) command(item.command);
    await screenshot(item.caption, number);
    ensure(30);
    page.drawRectangle({ x: left, y: y - 6, width, height: 22, color: MINT });
    page.drawText("Jawaban:", { x: left + 10, y, size: 10, font: bold, color: GREEN });
    page.drawText(item.answer, { x: left + 70, y, size: 10, font: mono, color: BLACK });
    y -= 34;
  };

  newPage();
  page.drawText(spec.title, { x: left, y, size: 20, font: bold, color: NAVY });
  y -= 18;
  page.drawText(spec.subtitle, { x: left, y, size: 11, font: italic, color: GRAY });
  y -= 26;
  table(
    [
      { label: "Nama", width: 0.25 },
      { label: "NPM", width: 0.25 },
      { label: "Kategori", width: 0.25 },
      { label: "Tingkat", width: 0.25 },
    ],
    [[spec.author, spec.npm, spec.category, spec.level]],
  );
  heading("Ringkasan Jawaban");
  table(
    [
      { label: "No", width: 0.08 },
      { label: "Pokok Pertanyaan", width: 0.46 },
      { label: "Jawaban", width: 0.46 },
    ],
    spec.questions.map((item, index) => [index + 1, item.topic, item.answer]),
  );
  heading("Latar Belakang");
  paragraph(spec.background);
  heading("Analisis");
  for (const [index, item] of spec.questions.entries()) await question(index + 1, item);
  heading("Flag");
  ensure(50);
  page.drawRectangle({
    x: left,
    y: y - 14,
    width,
    height: 34,
    color: MINT,
    borderColor: GREEN,
    borderWidth: 1.2,
  });
  page.drawText(spec.flag, { x: left + 12, y: y - 2, size: 11, font: mono, color: GREEN });
  y -= 48;
  heading("Kesimpulan");
  paragraph(spec.conclusion);

  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    current.drawLine({ start: { x: left, y: 46 }, end: { x: right, y: 46 }, thickness: 0.5, color: GRAY });
    current.drawText("CSCE604156 Weekly CTF", { x: left, y: 32, size: 8, font: regular, color: GRAY });
    const label = `Halaman ${index + 1} dari ${pages.length}`;
    current.drawText(label, {
      x: right - regular.widthOfTextAtSize(label, 8),
      y: 32,
      size: 8,
      font: regular,
      color: GRAY,
    });
  });
  return pdf.save();
}

const author = { author: "Rani Pratama", npm: "2306199999" };
const samples = [
  {
    file: "ProfileA_Exhibit_NET-02.pdf",
    ...author,
    code: "EXHIBIT NET-02",
    title: "Exhibit NET-02: Exfiltrasi lewat DNS",
    subtitle: "Analisis capture jaringan dari workstation divisi keuangan",
    category: "Network Forensics",
    level: "Menengah",
    background:
      "Tim keamanan menerima laporan bahwa data internal diduga keluar tanpa melalui proxy perusahaan. Berkas capture traffic.pcapng yang diambil dari switch lantai tiga diserahkan untuk dianalisis. Seluruh pemeriksaan dilakukan pada salinan berkas, dan nilai hash salinan telah dicocokkan dengan nilai hash berkas asli sebelum analisis dimulai.",
    questions: [
      {
        topic: "Host yang mengirim kueri mencurigakan",
        question: "Which internal host sent the unusually long DNS queries?",
        analysis:
          "Berkas capture dibuka menggunakan Wireshark, kemudian filter dns diterapkan dan hasilnya diurutkan berdasarkan panjang nama kueri. Kueri dengan subdomain yang sangat panjang seluruhnya berasal dari satu alamat internal, sedangkan host lain hanya mengirim kueri ke domain umum.",
        command:
          'tshark -r traffic.pcapng -Y "dns.qry.name.len > 60" \\\n  -T fields -e ip.src | sort | uniq -c',
        caption: "Kueri DNS dengan nama lebih dari 60 karakter",
        answer: "10.20.3.47",
      },
      {
        topic: "Domain tujuan exfiltrasi",
        question: "What second-level domain received the exfiltrated data?",
        analysis:
          "Bagian nama kueri dari host tersebut dipisahkan berdasarkan titik. Bagian depan berubah pada setiap kueri, sedangkan dua bagian terakhir selalu sama. Pola ini menunjukkan bahwa data disisipkan sebagai subdomain dari satu domain yang dikendalikan penyerang.",
        command: null,
        caption: "Pola subdomain pada kueri dari 10.20.3.47",
        answer: "cdn-sync.info",
      },
      {
        topic: "Encoding data pada subdomain",
        question: "Which encoding was used for the data inside the subdomains?",
        analysis:
          "Karakter pada subdomain hanya terdiri atas huruf kecil a sampai z dan angka 2 sampai 7, tanpa tanda sama dengan. Himpunan karakter tersebut sesuai dengan Base32 yang diubah ke huruf kecil. Potongan pertama berhasil didekode menjadi teks yang terbaca.",
        command: "echo 'mzxw6ytboi' | tr a-z A-Z | base32 -d",
        caption: "Hasil decode potongan pertama",
        answer: "Base32",
      },
      {
        topic: "Nama berkas yang dicuri",
        question: "What is the name of the file that was exfiltrated?",
        analysis:
          "Seluruh potongan diurutkan berdasarkan nomor urut di awal subdomain, kemudian digabungkan dan didekode. Baris pertama hasil decode berisi header yang menyebutkan nama berkas asal beserta ukurannya.",
        command: "python3 reassemble.py traffic.pcapng > recovered.bin\nhead -c 64 recovered.bin",
        caption: "Header berkas hasil rekonstruksi",
        answer: "payroll_q3.xlsx",
      },
    ],
    flag: "CTF{dns_l3aks_th3_p4yr0ll}",
    conclusion:
      "Workstation 10.20.3.47 mengirim isi berkas payroll_q3.xlsx ke domain cdn-sync.info dalam bentuk subdomain berkode Base32. Bukti yang tersedia hanya berasal dari capture jaringan, sehingga proses yang menjalankan exfiltrasi pada workstation belum dapat dipastikan.",
  },
  {
    file: "ProfileA_Exhibit_DISK-03.pdf",
    ...author,
    code: "EXHIBIT DISK-03",
    title: "Exhibit DISK-03: Persistensi di Registry",
    subtitle: "Pemeriksaan image disk laptop karyawan yang terinfeksi",
    category: "Disk Forensics",
    level: "Mudah",
    background:
      "Sebuah laptop dilaporkan menampilkan jendela command prompt setiap kali pengguna masuk. Image disk laptop.E01 diberikan bersama hash MD5 aslinya. Analisis difokuskan pada hive registry pengguna dan folder startup untuk menemukan mekanisme persistensi.",
    questions: [
      {
        topic: "Hive registry yang diperiksa",
        question: "Which user's NTUSER.DAT contains the persistence entry?",
        analysis:
          "Image dibuka menggunakan FTK Imager, kemudian hive NTUSER.DAT dari setiap profil pengguna diekspor. Hanya satu profil yang memiliki entri tambahan pada kunci Run, sedangkan profil lain hanya berisi entri bawaan sistem.",
        command: null,
        caption: "Daftar profil pengguna pada image",
        answer: "dimas.h",
      },
      {
        topic: "Nilai pada kunci Run",
        question: "What is the name of the value added under the Run key?",
        analysis:
          "Hive yang diekspor dibuka menggunakan Registry Explorer. Pada kunci Software\\Microsoft\\Windows\\CurrentVersion\\Run terdapat satu nilai dengan nama yang menyerupai komponen pembaruan sistem.",
        command: "rip.pl -r NTUSER.DAT -p run",
        caption: "Isi kunci Run pada hive dimas.h",
        answer: "WinUpdateHelper",
      },
      {
        topic: "Lokasi berkas yang dijalankan",
        question: "What is the full path of the executable started at logon?",
        analysis:
          "Data dari nilai WinUpdateHelper berisi jalur lengkap ke sebuah berkas di dalam folder AppData. Berkas tersebut kemudian ditemukan pada image dan hash-nya dihitung untuk pemeriksaan lanjutan.",
        command: "md5sum helper.exe",
        caption: "Data nilai WinUpdateHelper",
        answer: "C:\\Users\\dimas.h\\AppData\\Roaming\\helper.exe",
      },
      {
        topic: "Waktu kunci terakhir diubah",
        question: "When was the Run key last written (UTC)?",
        analysis:
          "Waktu LastWrite pada kunci Run dibaca dari Registry Explorer. Nilai waktu tersebut ditampilkan dalam UTC dan sesuai dengan waktu pembuatan berkas helper.exe pada tabel MFT.",
        command: null,
        caption: "Waktu LastWrite kunci Run",
        answer: "2026-09-14 02:11:39",
      },
    ],
    flag: "CTF{run_k3y_n3v3r_sl33ps}",
    conclusion:
      "Persistensi dibuat melalui nilai WinUpdateHelper pada kunci Run milik pengguna dimas.h yang menjalankan helper.exe dari folder AppData. Image tidak memuat log jaringan, sehingga tujuan komunikasi helper.exe tidak dapat ditentukan dari bukti ini.",
  },
];

mkdirSync(OUT, { recursive: true });
for (const sample of samples) {
  writeFileSync(new URL(sample.file, OUT), await writeup(sample));
  process.stdout.write(`Wrote ${new URL(sample.file, OUT).pathname}\n`);
}
