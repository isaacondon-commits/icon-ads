import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-800">
      <div className="text-center text-white p-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white/10 mb-6">
          <span className="text-white text-3xl font-bold">IA</span>
        </div>
        <h1 className="text-7xl font-bold mb-2 opacity-90">404</h1>
        <p className="text-xl mb-1 font-medium">Página no encontrada</p>
        <p className="text-white/60 text-sm mb-8">La URL que buscás no existe en el panel ICON ADS.</p>
        <Link href="/dashboard"
          className="inline-block bg-white text-blue-700 font-semibold px-6 py-2.5 rounded-xl hover:bg-blue-50 transition-colors">
          Ir al dashboard
        </Link>
      </div>
    </div>
  );
}
