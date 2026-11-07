"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { bahtToSatang } from "@/lib/money"
import { can } from "@/lib/permissions"

/** Turn a free-text name into a url-safe, lowercased, hyphenated slug. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

const TemplateInput = z.object({
  name: z.string().min(1, "Name is required"),
  categoryId: z.guid().optional().nullable(),
  description: z.string().optional().nullable(),
  internalValueBaht: z.coerce.number().min(0).optional().nullable(),
  priceBaht: z.coerce.number().min(0).optional().nullable(),
  reusableNotes: z.string().optional().nullable(),
  // Dynamic list of step strings -> stored as a JSON array in jsonb.
  implementationChecklist: z.array(z.string()).optional().default([]),
  // Comma-separated tags arrive already split into a string[].
  tags: z.array(z.string()).optional().default([]),
})

type TemplateValues = z.infer<typeof TemplateInput>

/** Map validated form values to the DB column shape (satang, jsonb, text[]). */
function toRow(data: TemplateValues, orgId: string) {
  const checklist = (data.implementationChecklist ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
  const tags = (data.tags ?? []).map((s) => s.trim()).filter(Boolean)

  return {
    org_id: orgId,
    name: data.name.trim(),
    category_id: data.categoryId ?? null,
    description: data.description?.trim() || null,
    internal_value_satang:
      data.internalValueBaht != null ? bahtToSatang(data.internalValueBaht) : null,
    price_satang: data.priceBaht != null ? bahtToSatang(data.priceBaht) : null,
    reusable_notes: data.reusableNotes?.trim() || null,
    // jsonb column: pass the string[] directly — supabase-js serializes it as a JSON array.
    implementation_checklist: checklist,
    tags,
  }
}

export async function createTemplate(
  input: TemplateValues
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "template:manage")) return { error: "Only owners and admins can manage templates." }
  const parsed = TemplateInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("automation_templates")
    .insert(toRow(parsed.data, ctx.orgId))
    .select("id")
    .single()

  if (error) return { error: error.message }

  revalidatePath("/templates")
  redirect(`/templates/${data.id}`)
}

export async function updateTemplate(
  id: string,
  input: TemplateValues
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "template:manage")) return { error: "Only owners and admins can manage templates." }
  if (!z.guid().safeParse(id).success) return { error: "Invalid template." }
  const parsed = TemplateInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("automation_templates")
    .update(toRow(parsed.data, ctx.orgId))
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("id")
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: "Template not found or unavailable." }

  revalidatePath("/templates")
  revalidatePath(`/templates/${id}`)
  redirect(`/templates/${id}`)
}

export async function deleteTemplate(id: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "template:manage")
  } catch {
    return { error: "Only owners and admins can delete templates." }
  }
  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("automation_templates")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/templates")
  redirect("/templates")
}

const CategoryInput = z.object({
  name: z.string().min(1, "Name is required"),
})

export async function createCategory(input: {
  name: string
}): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "template:manage")) return { error: "Only owners and admins can manage template categories." }
  const parsed = CategoryInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const slug = slugify(parsed.data.name)
  if (!slug) return { error: "Name must contain letters or numbers" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase.from("template_categories").insert({
    org_id: ctx.orgId,
    name: parsed.data.name.trim(),
    slug,
  })

  if (error) return { error: error.message }

  revalidatePath("/templates")
  return {}
}
