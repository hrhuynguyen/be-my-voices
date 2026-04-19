export interface Voice {
  id: number;
  name: string;
  elevenlabs_voice_id: string;
  description: string | null;
  is_cloned: boolean;
  created_at: string;
}

export interface CreateVoiceInput {
  name: string;
  elevenlabs_voice_id: string;
  description?: string | null;
  is_cloned?: boolean;
}

export interface CloneVoiceInput {
  name: string;
  description?: string | null;
  samples: File[];
}

export interface UpdateVoiceInput {
  name: string;
  description?: string | null;
}
