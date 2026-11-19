// REPORT V17: prop types declared in another file, read without running anything
export type Tone = 'info' | 'warn' | 'error';

export interface TypedProps {
  tone: Tone;
  size?: 1 | 2 | 3;
  label: string;
  tags?: string[];
}
