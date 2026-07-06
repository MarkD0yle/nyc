export interface GeoPersona {
  id: number;
  lng: number;
  lat: number;
  puma: string;
  borough: string;
  neighborhood: string;
  age: number;
  sex: string;
  race_ethnicity: string;
  education: string;
  employment: string;
  personal_income: number | null;
  household_income: number | null;
  household_size: number;
  housing: string;
  gross_rent: number | null;
  language_at_home: string;
  commute: string;
  context_notes: string;
  subway_distance_m?: number;
  nearest_station_name?: string;
  nearest_station_lines?: string;
  ada_nearby?: boolean;
}
