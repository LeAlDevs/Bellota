import Image from "next/image";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Panel de marca */}
      <div className="hidden w-[46%] flex-col justify-between bg-[#2a1b0f] p-14 text-[#e7dbcb] lg:flex">
        <div className="flex items-center gap-3">
          <Image src="/bellota.webp" alt="" width={34} height={34} priority />
          <span className="text-[19px] font-semibold tracking-[-0.01em] text-[#fbf6ef]">
            Bellota
          </span>
        </div>

        <div className="flex max-w-[430px] flex-col gap-6">
          <h2 className="text-[44px] font-semibold leading-[1.12] tracking-[-0.03em] text-[#fbf6ef]">
            El mostrador, el stock y la plata de Ibérico en un solo lugar.
          </h2>
          <p className="text-[15px] leading-relaxed text-[#b7a48c]">
            Ramos y Mosconi, con el mismo precio, el mismo PLU en las cuatro
            balanzas y la caja cerrada todas las noches.
          </p>
        </div>

        <div className="flex gap-9 border-t border-[#3d2916] pt-6">
          <div className="flex flex-col gap-1">
            <span className="num text-2xl text-[#f0dfc7]">2</span>
            <span className="text-xs text-[#8c7862]">locales</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="num text-2xl text-[#f0dfc7]">4</span>
            <span className="text-xs text-[#8c7862]">balanzas sincronizadas</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="num text-2xl text-[#f0dfc7]">1</span>
            <span className="text-xs text-[#8c7862]">
              lugar donde se carga el precio
            </span>
          </div>
        </div>
      </div>

      {/* Formulario */}
      <div className="flex flex-1 items-center justify-center p-10">
        <LoginForm />
      </div>
    </div>
  );
}
