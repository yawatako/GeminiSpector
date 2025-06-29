export interface Claim {
  subject: string;
  predicate: string;
  object?: string;
}

export interface Evidence {
  url: string;
  snippet: string;
}

export interface Verification {
  claim: Claim;
  isCorrect: boolean;
  evidence: Evidence[];
}
