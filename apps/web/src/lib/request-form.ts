// Client-side checks of the public request form (#8). The API checks the
// same rules; these only spare a round trip.

type FieldMode = "off" | "optional" | "required";

type FormShape = {
  fields: { description: FieldMode; email: FieldMode; name: FieldMode };
  customFields: { id: string; required: boolean }[];
};

type FormValues = {
  title: string;
  description: string;
  email: string;
  name: string;
  custom: Record<string, string>;
};

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;

/** The names of required fields left empty, or an invalid email. */
export function missingRequestFields(
  form: FormShape,
  values: FormValues,
): string[] {
  const missing: string[] = [];
  if (!values.title.trim()) missing.push("title");
  if (form.fields.description === "required" && !values.description.trim()) {
    missing.push("description");
  }
  if (form.fields.name === "required" && !values.name.trim()) {
    missing.push("name");
  }
  const email = values.email.trim();
  if (
    (form.fields.email === "required" && !email) ||
    (form.fields.email !== "off" && email && !EMAIL.test(email))
  ) {
    missing.push("email");
  }
  for (const field of form.customFields) {
    if (field.required && !(values.custom[field.id] ?? "").trim()) {
      missing.push(field.id);
    }
  }
  return missing;
}
