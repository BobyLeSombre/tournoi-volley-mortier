// Création d'un fichier ZIP « store » (sans compression), sans dépendance.
// Les photos sont des JPEG déjà compressés : les recompresser ne gagnerait
// rien, donc on les stocke telles quelles dans une archive ZIP standard.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Assemble un ZIP à partir de [{ name, buf }]. Retourne un Buffer directement
 * envoyable en réponse HTTP.
 */
export function createStoreZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, buf } of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(buf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version nécessaire
    local.writeUInt16LE(0x0800, 6); // drapeau : noms en UTF-8
    local.writeUInt16LE(0, 8); // méthode : store
    local.writeUInt16LE(0, 10); // heure
    local.writeUInt16LE(0x0021, 12); // date DOS valide : 1er janv. 1980
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(buf.length, 18); // taille compressée
    local.writeUInt32LE(buf.length, 22); // taille réelle
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra
    chunks.push(local, nameBuf, buf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // signature entrée centrale
    cd.writeUInt16LE(20, 4); // version créatrice
    cd.writeUInt16LE(20, 6); // version nécessaire
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0x0021, 12); // date DOS valide
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(buf.length, 20);
    cd.writeUInt32LE(buf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // commentaire
    cd.writeUInt16LE(0, 34); // disque
    cd.writeUInt16LE(0, 36); // attributs internes
    cd.writeUInt32LE(0, 38); // attributs externes
    cd.writeUInt32LE(offset, 42); // position de l'en-tête local
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + buf.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // fin du répertoire central
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}
