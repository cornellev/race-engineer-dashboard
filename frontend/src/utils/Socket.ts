import { backendWsUrl } from "./backend";
export interface SocketData {
  seq: number;
  global_ts: number;
  power: {
    ts: number;
    current: number;
    voltage: number;
  };
  steering: {
    ts: number;
    brake_pressure: number;
    turn_angle: number;
  };
  rpm_front: {
    ts: number;
    rpm_left: number;
    rpm_right: number;
  };
  rpm_back: {
    ts: number;
    rpm_left: number;
    rpm_right: number;
  };
  gps: {
    ts: number;
    lat: number;
    long: number;
    heading: number;
    speed: number;
  };
  motor: {
    ts: number;
    rpm: number;
    duty_cycle: number;
  };
  filtered: {
    speed: number;
  };
  latency_ms: number | null;
}

type MessageHandler = (data: SocketData) => void;

type LooseRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is LooseRecord =>
  typeof value === "object" && value !== null;

const asRecord = (value: unknown): LooseRecord =>
  (isRecord(value) ? value : {}) as LooseRecord;

const toNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
};

const toTimestampMs = (value: unknown): number | null => {
  const numericValue = toNumber(value, Number.NaN);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  if (numericValue > 10e12) {
    return numericValue / 1e6;
  }

  if (numericValue > 1e12) {
    return numericValue / 1e3;
  }

  return numericValue;
};

export const normalizeSocketData = (
  payload: unknown,
  envelope?: LooseRecord,
  recvMs?: number,
): SocketData => {
  const root = asRecord(payload);
  const power = asRecord(root.power);
  const steering = asRecord(root.steering);
  const gps = asRecord(root.gps);
  const location = asRecord(root.location);
  const motor = asRecord(root.motor);
  const filtered = asRecord(root.filtered);
  const rpmFront = asRecord(root.rpm_front);
  const rpmBack = asRecord(root.rpm_back);

  const speedValue =
    gps.speed ?? motor.velocity ?? motor.speed ?? filtered.speed ?? root.speed;

  const timestampCandidates = [
    root.global_ts,
    root.ts,
    gps.ts,
    location.ts,
    power.ts,
    motor.ts,
    steering.ts,
    filtered.ts,
    envelope?.stamp_ns,
  ];

  const globalTimestamp =
    timestampCandidates
      .map((candidate) => toTimestampMs(candidate))
      .find((candidate) => candidate !== null) ?? Date.now();

  const tPublishNs = toNumber(root._t_publish_ns, Number.NaN);
  const latency_ms =
    recvMs != null && Number.isFinite(tPublishNs) && tPublishNs > 0
      ? recvMs - tPublishNs / 1e6
      : null;

  return {
    seq: toNumber(root.seq ?? envelope?.seq, 0),
    global_ts: globalTimestamp,
    power: {
      ts: toTimestampMs(power.ts) ?? globalTimestamp,
      current: toNumber(power.current),
      voltage: toNumber(power.voltage),
    },
    steering: {
      ts: toTimestampMs(steering.ts) ?? globalTimestamp,
      brake_pressure: toNumber(
        steering.brake_pressure ?? steering.brake ?? steering.pressure,
      ),
      turn_angle: toNumber(
        steering.turn_angle ?? steering.angle ?? steering.steering_angle,
      ),
    },
    rpm_front: {
      ts: toTimestampMs(rpmFront.ts) ?? globalTimestamp,
      rpm_left: toNumber(rpmFront.rpm_left),
      rpm_right: toNumber(rpmFront.rpm_right),
    },
    rpm_back: {
      ts: toTimestampMs(rpmBack.ts) ?? globalTimestamp,
      rpm_left: toNumber(rpmBack.rpm_left),
      rpm_right: toNumber(rpmBack.rpm_right),
    },
    gps: {
      ts: toTimestampMs(gps.ts ?? location.ts) ?? globalTimestamp,
      lat: toNumber(gps.lat ?? location.lat, 42.44666485723302),
      long: toNumber(gps.long ?? location.long, -76.4608710371343),
      heading: toNumber(gps.heading),
      speed: toNumber(speedValue),
    },
    motor: {
      ts: toTimestampMs(motor.ts) ?? globalTimestamp,
      rpm: toNumber(motor.rpm),
      duty_cycle: toNumber(motor.duty_cycle ?? motor.throttle),
    },
    filtered: {
      speed: toNumber(filtered.speed ?? speedValue),
    },
    latency_ms,
  };
};

import dummyData from "./data" with { type: "json" };
dummyData.map((data) => {
  normalizeSocketData(data);
});

class SocketService {
  private static instance: SocketService;
  private socket: WebSocket | null = null;
  private url: string = backendWsUrl("/ws/stream");
  private handlers: Set<MessageHandler> = new Set();
  private reconnectInterval: number = 5000;
  private data: SocketData[] = [];
  private dataTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly DATA_TIMEOUT_MS = 5000;
  private lastMessageAt: number | null = null;

  private constructor() {}

  public static getInstance(): SocketService {
    if (!SocketService.instance) {
      SocketService.instance = new SocketService();
    }
    return SocketService.instance;
  }

  public connect(): void {
    if (this.socket?.readyState === WebSocket.OPEN) return;

    this.socket = new WebSocket(this.url);

    this.socket.onopen = () => {
      console.log("WebSocket Connected");
    };

    this.socket.onmessage = (event: MessageEvent) => {
      const recvMs = Date.now();
      this.lastMessageAt = recvMs;
      const envelope = JSON.parse(event.data);
      const data = normalizeSocketData(
        envelope.data ?? envelope,
        asRecord(envelope),
        recvMs,
      );
      this.data = [...this.data.slice(-1200), data];
      this.handlers.forEach((handler) => handler(data));
      this.resetDataTimeout();
    };

    this.socket.onclose = () => {
      console.log("WebSocket Disconnected. Reconnecting...");
      setTimeout(() => this.connect(), this.reconnectInterval);
    };

    this.socket.onerror = (error) => {
      console.error("WebSocket Error:", error);
      this.socket?.close();
    };
  }

  private resetDataTimeout(): void {
    if (this.dataTimeoutHandle) clearTimeout(this.dataTimeoutHandle);
    this.dataTimeoutHandle = setTimeout(() => {
      console.warn(
        `[ROS] Error: no data received for >${this.DATA_TIMEOUT_MS / 1000}s. possible reasons:` +
          `\n- ros publisher is not publishing` +
          `\n- tailscale connection is not working properly` +
          `\n- you are not using the correct fastdds discovery server ip address`,
      );
    }, this.DATA_TIMEOUT_MS);
  }

  public subscribe(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    // Return unsubscribe function
    return () => this.handlers.delete(handler);
  }

  public getData(): SocketData[] {
    return this.data;
  }

  /** Epoch ms of the last live message, or null if none arrived yet. */
  public getLastMessageAt(): number | null {
    return this.lastMessageAt;
  }

  public getLatestData(): SocketData | null {
    return this.data.length > 0 ? this.data[this.data.length - 1] : null;
  }

  public send(data: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    } else {
      console.error("Socket not connected");
    }
  }

  public disconnect(): void {
    this.socket?.close();
  }
}

const socketService = SocketService.getInstance();

export default socketService;
