import { Placeholder } from "@/components/shell/placeholder";

export default function Page() {
  return (
    <Placeholder
      title="Punto de venta"
      description="El mostrador: buscar, pesar, cobrar."
      phase={4}
      items={[
        "Búsqueda por nombre o PLU, y escaneo de la etiqueta de la balanza",
        "Peso tipeado a mano, para vender desde el día uno sin esperar a las balanzas",
        "Cobro con varios medios de pago, con recargo por medio",
        "Marca fiscal / no fiscal en cada venta",
        "Versión celular usable a 390px, para cuando se cae internet",
      ]}
    />
  );
}
