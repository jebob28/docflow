import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { authService } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const loginSchema = z.object({
  email: z.string().email({ message: "Email inválido" }),
  password: z.string().min(6, { message: "A senha deve ter pelo menos 6 caracteres" }),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(values: LoginFormValues) {
    setLoading(true);
    setError(null);
    try {
      await authService.login(values);
      navigate('/dashboard');
    } catch (err) {
      const error = err as { response?: { data?: { message?: string } } };
      setError(error.response?.data?.message || "Credenciais inválidas. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f4f7fe] p-4 font-sans">
      <div className="w-full max-w-[420px] space-y-8">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[#1b254b] rounded-[22px] shadow-2xl shadow-blue-900/20 mb-6 group transition-all hover:scale-110 duration-300">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-[#1b254b] tracking-tight mb-2">GED SaaS</h1>
          <p className="text-slate-400 text-sm font-medium">Bem-vindo ao painel administrativo</p>
        </div>

        <Card className="border-none shadow-[0_20px_50px_rgba(0,0,0,0.05)] bg-white rounded-[24px] sm:rounded-[30px] overflow-hidden p-1 sm:p-2">
          <CardHeader className="pt-6 sm:pt-8 pb-3 sm:pb-4 px-6 sm:px-8">
            <CardTitle className="text-xl sm:text-2xl font-bold text-slate-800">Login</CardTitle>
            <CardDescription className="text-slate-400 text-[10px] sm:text-xs font-medium">
              Insira seu email e senha para acessar o sistema.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-6 sm:px-8 pb-6 sm:pb-8 pt-0">
            {error && (
              <div className="bg-rose-50 text-rose-600 text-[10px] sm:text-[11px] font-bold p-3 rounded-xl sm:rounded-2xl border border-rose-100 text-center mb-5 sm:mb-6 animate-in fade-in slide-in-from-top-2">
                {error}
              </div>
            )}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 sm:space-y-5">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-slate-700 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider ml-1">Email</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="seu@email.com" 
                          {...field} 
                          className="h-11 sm:h-12 bg-slate-50 border-none rounded-xl sm:rounded-2xl px-4 text-sm focus-visible:ring-blue-500/10 placeholder:text-slate-300 transition-all font-medium"
                        />
                      </FormControl>
                      <FormMessage className="text-[10px] font-bold ml-1 text-rose-500" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-slate-700 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider ml-1">Senha</FormLabel>
                      <FormControl>
                        <Input 
                          type="password" 
                          placeholder="••••••••" 
                          {...field} 
                          className="h-11 sm:h-12 bg-slate-50 border-none rounded-xl sm:rounded-2xl px-4 text-sm focus-visible:ring-blue-500/10 placeholder:text-slate-300 transition-all font-medium"
                        />
                      </FormControl>
                      <FormMessage className="text-[10px] font-bold ml-1 text-rose-500" />
                    </FormItem>
                  )}
                />
                <Button 
                  type="submit" 
                  className="w-full bg-[#1b254b] hover:bg-[#1b254b]/95 text-white font-bold h-11 sm:h-12 rounded-xl sm:rounded-2xl shadow-lg shadow-blue-900/10 transition-all hover:scale-[1.01] active:scale-[0.99] mt-2"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Autenticando...
                    </>
                  ) : (
                    "Acessar Painel"
                  )}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <p className="text-[11px] text-center text-slate-400 font-bold uppercase tracking-widest">
          &copy; {new Date().getFullYear()} GED SaaS Admin
        </p>
      </div>
    </div>
  );
}
