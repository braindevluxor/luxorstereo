import { Radio } from "lucide-react";
import BranchPlayer from "@/components/player/BranchPlayer";

// Ruta que se abre en la tablet/PC/Raspberry Pi de cada sucursal.
// El branch_key (secreto de la sucursal) llega por query string.
export default async function BranchPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const { key } = await searchParams;

  if (!key) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="max-w-md rounded-3xl border border-slate-200 bg-surface p-8 text-center shadow-2xl">
          <span className="brand-gradient mx-auto flex h-14 w-14 items-center justify-center rounded-2xl text-white">
            <Radio size={28} />
          </span>
          <h1 className="mt-4 text-xl font-bold text-slate-900">
            Falta la clave de sucursal
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Abre esta pantalla con la URL que genera el panel de administración:
          </p>
          <code className="mt-4 block rounded-xl bg-slate-800 px-3 py-2 text-xs text-blue-400">
            /branch?key=&lt;branch_key&gt;
          </code>
        </div>
      </main>
    );
  }

  return <BranchPlayer branchKey={key} />;
}
