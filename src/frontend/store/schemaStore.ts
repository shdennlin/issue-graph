import { create } from 'zustand'
import type { DetectedSchema } from '@shared/types.js'
import { api, type LabelsResponse } from '../lib/api'

const EMPTY: DetectedSchema = {
  primaryGroup: null,
  typeGroup: null,
  prefixes: [],
  orphans: [],
  otherGroups: [],
}

interface SchemaState {
  schema: DetectedSchema
  typeIcons: Record<string, string>
  primaryGroupSingular: string | null
  load: () => Promise<void>
}

export const useSchemaStore = create<SchemaState>((set) => ({
  schema: EMPTY,
  typeIcons: {},
  primaryGroupSingular: null,
  async load() {
    try {
      const res: LabelsResponse = await api.fetchLabels()
      set({
        schema: res.schema,
        typeIcons: res.typeIcons,
        primaryGroupSingular: res.primaryGroupSingular,
      })
    } catch {
      // keep previous values
    }
  },
}))
