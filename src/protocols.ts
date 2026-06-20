export const PROTO_TROJAN = 'trojan';
export const PROTO_VMESS  = 'vmess';
export const PROTO_SS     = 'ss';

export interface ParsedAddress {
  addr?: string;
  end?: number;
  error?: string;
}

export function parseAddress(buf: Buffer, offset: number): ParsedAddress {
  const addrType = buf[offset];
  let addrLen = 0, addrStart = offset + 1, addr = '';

  if (addrType === 1) {
    addrLen = 4;
    addr = Array.from(buf.subarray(addrStart, addrStart + addrLen)).join('.');
  } else if (addrType === 2 || addrType === 3) {
    addrLen = buf[addrStart];
    addrStart += 1;
    addr = buf.subarray(addrStart, addrStart + addrLen).toString();
  } else if (addrType === 4) {
    addrLen = 16;
    const parts: string[] = [];
    for (let i = 0; i < 8; i++) parts.push(buf.readUInt16BE(addrStart + i * 2).toString(16));
    addr = parts.join(':');
  } else {
    return { error: `Unknown address type: ${addrType}` };
  }

  if (!addr) return { error: 'Empty address' };
  return { addr, end: addrStart + addrLen };
}

export interface ProtocolHeader {
  hasError: boolean;
  message?: string;
  addressRemote?: string;
  portRemote?: number;
  rawDataIndex?: number;
  rawClientData?: Buffer;
  version?: Buffer | null;
  isUDP?: boolean;
}

export function readTrojanHeader(buf: Buffer): ProtocolHeader {
  const payload = buf.subarray(58);
  if (payload.length < 6) return { hasError: true, message: 'Trojan: payload too short' };

  const cmd = payload[0];
  const isUDP = cmd === 3;
  if (cmd !== 1 && cmd !== 3) return { hasError: true, message: `Trojan: unsupported cmd ${cmd}` };

  const parsed = parseAddress(payload, 1);
  if (parsed.error) return { hasError: true, message: parsed.error };

  const portOffset = parsed.end!;
  const port = payload.readUInt16BE(portOffset);

  return {
    hasError: false,
    addressRemote: parsed.addr,
    portRemote: port,
    rawDataIndex: portOffset + 4,
    rawClientData: payload.subarray(portOffset + 4),
    version: null,
    isUDP,
  };
}

export function readVmessHeader(buf: Buffer): ProtocolHeader {
  const version = buf[0];
  const optLen = buf[17];
  const cmd = buf[18 + optLen];
  const isUDP = cmd === 2;
  if (cmd !== 1 && cmd !== 2) return { hasError: true, message: `VMess: unsupported cmd ${cmd}` };

  const portOffset = 18 + optLen + 1;
  const port = buf.readUInt16BE(portOffset);

  const parsed = parseAddress(buf, portOffset + 2);
  if (parsed.error) return { hasError: true, message: parsed.error };

  return {
    hasError: false,
    addressRemote: parsed.addr,
    portRemote: port,
    rawDataIndex: parsed.end,
    rawClientData: buf.subarray(parsed.end!),
    version: Buffer.from([version, 0]),
    isUDP,
  };
}

export function readShadowsocksHeader(buf: Buffer): ProtocolHeader {
  const parsed = parseAddress(buf, 0);
  if (parsed.error) return { hasError: true, message: parsed.error };

  const portOffset = parsed.end!;
  const port = buf.readUInt16BE(portOffset);

  return {
    hasError: false,
    addressRemote: parsed.addr,
    portRemote: port,
    rawDataIndex: portOffset + 2,
    rawClientData: buf.subarray(portOffset + 2),
    version: null,
    isUDP: port === 53,
  };
}

export function sniffProtocol(buf: Buffer): string {
  // Trojan: CRLF + specific bytes at offset 56
  if (buf.length >= 62) {
    const d = buf.subarray(56, 60);
    if (
      d[0] === 0x0d && d[1] === 0x0a &&
      [0x01, 0x03, 0x7f].includes(d[2]) &&
      [0x01, 0x03, 0x04].includes(d[3])
    ) return PROTO_TROJAN;
  }
  // VMess/VLESS: UUID-like pattern at bytes 1–17
  const hex = buf.subarray(1, 17).toString('hex');
  if (/^[0-9a-f]{8}[0-9a-f]{4}4[0-9a-f]{3}[89ab][0-9a-f]{3}[0-9a-f]{12}$/i.test(hex)) {
    return PROTO_VMESS;
  }
  return PROTO_SS;
}
