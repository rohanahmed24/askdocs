"use client";

import { useActionState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { TextField } from "@/components/text-field";
import { createOrganizationAction, type OnboardingState } from "./actions";

const initial: OnboardingState = { error: null };

export function OrganizationForm() {
  const [state, action, pending] = useActionState(createOrganizationAction, initial);
  return (
    <form action={action} className="flex flex-col gap-5">
      <TextField id="name" name="name" label="Organization name" placeholder="Northwind Studio" required minLength={2} maxLength={60} />
      <FormError message={state.error} />
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create organization"}
      </Button>
    </form>
  );
}
