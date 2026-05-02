export type ChipType = 'time' | 'location' | 'link' | 'note';

export interface PlanChip {
  id: string;
  type: ChipType;
  value: string;
  isNew?: boolean;
  source?: 'user' | 'ai';
}

export interface PlanItem {
  id: string;
  text: string;
  depth: 0 | 1 | 2;
  checked: boolean;
  chips: PlanChip[];
  placeholder?: string;
  isNew?: boolean;
}

export interface PlanDocument {
  id: string;
  date: string;         // YYYY-MM-DD
  items: PlanItem[];
  createdAt: string;
  updatedAt: string;
}
