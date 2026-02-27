export interface RawRow {
  name: string;
  pillar: string;
  func: string;
  allocArea: string;
  teamGroup: string;
  l4_7: string;
  empCount: string;
}

export interface BenchmarkInput {
  toplineRate: number;
  pdFunctionRate: number;
  dataAsOf: string;
}

export interface ScraperState {
  lastSuccess: string | null;
  lastSuccessRows: RawRow[];
  consecutiveFailures: number;
  sessionAlertSent: boolean;
  lastFailureReason: string | null;
}
