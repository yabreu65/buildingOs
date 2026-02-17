"use client";

import { useMemo, useState } from "react";
import Button from "@/shared/components/ui/Button";
import Input from "@/shared/components/ui/Input";
import Select from "@/shared/components/ui/Select";
import { addLead } from "@/features/marketing/marketing.storage";
import type { Lead } from "@/features/marketing/marketing.types";

export default function CtaForm() {
  const empty = useMemo(
    () => ({
      name: "",
      email: "",
      whatsapp: "",
      country: "" as Lead["country"],
      type: "" as Lead["type"],
    }),
    []
  );

  const [formData, setFormData] = useState(empty);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const lead: Lead = {
      name: formData.name.trim(),
      email: formData.email.trim(),
      whatsapp: formData.whatsapp?.trim() || undefined,
      country: formData.country,
      type: formData.type,
      createdAt: new Date().toISOString(),
      source: "landing",
    };
    addLead(lead);

    setSubmitted(true);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const reset = () => {
    setFormData(empty);
    setSubmitted(false);
  };

  return (
    <section id="demo" className="py-20 bg-primary text-primary-foreground">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6 text-primary-foreground">
          ¿Listo para ordenar tu administración?
        </h2>
        <p className="text-lg text-primary-foreground/80 mb-10 max-w-2xl mx-auto">
          Sumate a la lista de espera y sé de los primeros en probar BuildingOS.
        </p>

        {submitted ? (
          <div className="bg-primary-foreground/10 p-8 rounded-xl backdrop-blur-sm border border-primary-foreground/20">
            <h3 className="text-2xl font-bold text-primary-foreground mb-2">
              ¡Mensaje recibido!
            </h3>
            <p className="text-primary-foreground/80">
              Te contactaremos pronto a{" "}
              <span className="font-semibold text-primary-foreground">
                {formData.email}
              </span>
              .
            </p>

            {formData.whatsapp?.trim() ? (
              <p className="mt-2 text-sm text-primary-foreground/80">
                También tenemos tu WhatsApp:{" "}
                <span className="font-medium text-primary-foreground">
                  {formData.whatsapp}
                </span>
              </p>
            ) : null}

            <Button
              variant="secondary"
              className="mt-6 bg-primary-foreground text-primary hover:opacity-90"
              onClick={reset}
            >
              Enviar otro
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="max-w-md mx-auto bg-card text-card-foreground p-6 rounded-xl shadow-2xl text-left space-y-4 border border-border"
          >
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">
                Nombre completo
              </label>
              <Input
                id="name"
                name="name"
                required
                placeholder="Juan Pérez"
                value={formData.name}
                onChange={handleChange}
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-1">
                Email
              </label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="juan@administracion.com"
                value={formData.email}
                onChange={handleChange}
              />
            </div>

            <div>
              <label
                htmlFor="whatsapp"
                className="block text-sm font-medium mb-1"
              >
                WhatsApp <span className="text-muted-foreground">(opcional)</span>
              </label>
              <Input
                id="whatsapp"
                name="whatsapp"
                placeholder="+58 412 000 0000"
                value={formData.whatsapp}
                onChange={handleChange}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="country"
                  className="block text-sm font-medium mb-1"
                >
                  País
                </label>
                <Select
                  id="country"
                  name="country"
                  required
                  value={formData.country}
                  onChange={handleChange}
                >
                  <option value="">Seleccionar</option>
                  <option value="VE">Venezuela</option>
                  <option value="AR">Argentina</option>
                  <option value="CO">Colombia</option>
                  <option value="OTHER">Otro</option>
                </Select>
              </div>

              <div>
                <label htmlFor="type" className="block text-sm font-medium mb-1">
                  Soy...
                </label>
                <Select
                  id="type"
                  name="type"
                  required
                  value={formData.type}
                  onChange={handleChange}
                >
                  <option value="">Seleccionar</option>
                  <option value="ADMIN">Administradora</option>
                  <option value="SELF">Autogestión</option>
                </Select>
              </div>
            </div>

            <Button type="submit" className="w-full h-11 text-base mt-2">
              Solicitar demo
            </Button>

            <p className="text-xs text-muted-foreground pt-2">
              Al enviar, guardamos tu contacto localmente para esta demo (MVP). Luego lo conectamos a backend.
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
