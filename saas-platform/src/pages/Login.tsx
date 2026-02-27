import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useNavigate } from 'react-router-dom';
import { Loader2, Eye, EyeOff, Mail, Lock as LockIcon, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';

const loginSchema = z.object({
  email: z.string().email({ message: "E-mail inválido" }),
  password: z.string().min(6, { message: "A senha deve ter pelo menos 6 caracteres" }),
  totp_code: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().regex(/^\d{6}$/, { message: "Código MFA inválido" }).optional()
  ),
});

const changePasswordSchema = z.object({
  newPassword: z.string().min(8, { message: "A nova senha deve ter pelo menos 8 caracteres" }),
  confirmPassword: z.string().min(8, { message: "A confirmação deve ter pelo menos 8 caracteres" }),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "As senhas não coincidem",
  path: ["confirmPassword"],
});

type LoginFormValues = z.infer<typeof loginSchema>;
type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;

export default function Login() {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema) as Resolver<LoginFormValues>,
    defaultValues: {
      email: "",
      password: "",
      totp_code: "",
    },
  });

  const changePasswordForm = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onChange",
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  });

  async function onLoginSubmit(values: LoginFormValues) {
    setLoading(true);
    setError(null);
    try {
      if (mfaRequired && !values.totp_code) {
        setError("Informe o código MFA para continuar.");
        setLoading(false);
        return;
      }
      const response = await fetch('/api/v1/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: values.email,
          password: values.password,
          totp_code: values.totp_code,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('token', data.token);
        if (data.user) {
          localStorage.setItem('user', JSON.stringify(data.user));
        }
        
        // Em um sistema real, poderíamos checar se é primeiro login pelo backend
        // Para manter a lógica visual de reset de senha se a senha for "123456"
        setMfaRequired(false);
        if (values.password === "123456") {
          setIsFirstLogin(true);
        } else {
          navigate('/documents');
        }
      } else {
        const text = await response.text();
        const message = (() => {
          try {
            const json = JSON.parse(text);
            return json.message || text;
          } catch {
            return text || "Credenciais inválidas. Tente novamente.";
          }
        })();
        if (message.toLowerCase().includes("mfa") || message.toLowerCase().includes("2fa")) {
          setMfaRequired(true);
        }
        setError(message);
      }
    } catch {
      setError("Erro de conexão. Tente novamente mais tarde.");
    } finally {
      setLoading(false);
    }
  }

  async function onChangePasswordSubmit(values: ChangePasswordFormValues) {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/v1/reset-password', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          new_password: values.newPassword
        }),
      });

      if (response.ok) {
        setIsFirstLogin(false);
        navigate('/documents');
      } else {
        const errorData = await response.json().catch(() => ({}));
        setError(errorData.message || "Erro ao alterar senha. Tente novamente.");
      }
    } catch {
      setError("Erro de conexão ao alterar senha. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f6f7f8] p-4 md:p-8">
      <Card className="w-full max-w-[1000px] overflow-hidden border-none shadow-2xl bg-white rounded-3xl md:rounded-[40px]">
        <CardContent className="p-0 flex flex-col md:flex-row min-h-[500px] md:min-h-[600px]">
          {/* Lado Esquerdo - Branding */}
          <div className="md:w-[40%] bg-[#1a355b] p-8 md:p-12 flex flex-col justify-center text-white relative overflow-hidden min-h-[200px] md:min-h-full">
            <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
              <div className="absolute top-[-10%] right-[-10%] w-[200px] md:w-[300px] h-[200px] md:h-[300px] bg-white rounded-full blur-[100px]" />
              <div className="absolute bottom-[-10%] left-[-10%] w-[150px] md:w-[200px] h-[150px] md:h-[200px] bg-blue-400 rounded-full blur-[80px]" />
            </div>
            
            <div className="relative z-10 space-y-4 md:space-y-6">
              <div className="flex items-center gap-3 md:mb-8">
                <div className="p-2 bg-white/10 rounded-xl backdrop-blur-sm border border-white/10">
                  <FileText className="h-6 w-6 text-white" />
                </div>
                <span className="text-xl font-black tracking-tighter">DocFlow</span>
              </div>
              <h1 className="text-2xl md:text-4xl font-bold leading-tight">
                Gerencie seus documentos com facilidade.
              </h1>
              <p className="text-blue-100 text-sm md:text-lg opacity-80 hidden md:block">
                A plataforma líder para fluxos de trabalho digitais e gestão documental segura.
              </p>
            </div>

            <div className="absolute bottom-8 left-8 md:left-12 opacity-40 text-[10px] md:text-xs hidden md:block">
              © 2024 DocFlow Tecnologia S.A.
            </div>
          </div>

          {/* Lado Direito - Formulário */}
          <div className="md:w-[60%] p-6 md:p-16 flex flex-col justify-center bg-white">
            {!isFirstLogin ? (
              <div className="space-y-8 animate-in fade-in duration-500">
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold text-slate-900">Bem-vindo de volta</h2>
                  <p className="text-slate-500">Acesse sua conta para continuar</p>
                </div>

                {error && (
                  <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 text-sm font-medium">
                    {error}
                  </div>
                )}

                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-5">
                    <FormField
                      control={loginForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <FormLabel className="text-slate-700 font-semibold">E-mail</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                              <Input 
                                placeholder="exemplo@docflow.com.br" 
                                {...field} 
                                className="pl-10 h-12 bg-slate-50 border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all rounded-xl"
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem className="space-y-2">
                          <div className="flex items-center justify-between">
                            <FormLabel className="text-slate-700 font-semibold">Senha</FormLabel>
                            <Button 
                              type="button"
                              variant="link" 
                              className="text-xs text-blue-600 font-bold p-0 h-auto"
                              onClick={() => {
                                const email = loginForm.getValues('email');
                                if (!email) {
                                  toast.error('Insira seu e-mail primeiro.');
                                } else {
                                  toast.success(`E-mail de recuperação enviado para: ${email}`);
                                }
                              }}
                            >
                              Esqueceu a senha?
                            </Button>
                          </div>
                          <FormControl>
                            <div className="relative">
                              <LockIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                              <Input 
                                {...field}
                                type={showPassword ? "text" : "password"}
                                placeholder="Sua senha" 
                                className="pl-10 pr-10 h-12 bg-slate-50 border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all rounded-xl"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                              >
                                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                              </button>
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {mfaRequired && (
                      <FormField
                        control={loginForm.control}
                        name="totp_code"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-slate-700 font-medium">Código MFA</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  placeholder="000000"
                                  className="h-12 rounded-xl bg-slate-50 border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all pl-11"
                                  {...field}
                                />
                                <LockIcon className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <Button 
                      type="submit" 
                      className="w-full h-12 bg-[#1a355b] hover:bg-[#1a355b]/90 text-white font-bold rounded-xl transition-all active:scale-[0.98]"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="animate-spin" /> : "Entrar"}
                    </Button>

                    <div className="relative py-4">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-slate-100" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-white px-4 text-slate-400 font-semibold">Ou entrar com</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <Button 
                        type="button"
                        variant="outline" 
                        className="h-12 border-slate-200 rounded-xl font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => toast.info('Login via Google indisponível no momento.')}
                      >
                        <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                        </svg>
                        Google
                      </Button>
                      <Button 
                        type="button"
                        variant="outline" 
                        className="h-12 border-slate-200 rounded-xl font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => toast.info('Login via Facebook indisponível no momento.')}
                      >
                        <svg className="mr-2 h-5 w-5 fill-[#1877F2]" viewBox="0 0 24 24">
                          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                        </svg>
                        Facebook
                      </Button>
                    </div>

                    <p className="text-center text-sm text-slate-500 font-medium">
                      Ainda não tem uma conta? <button type="button" className="text-blue-600 font-bold hover:underline" onClick={() => toast.info('O cadastro de novos clientes deve ser solicitado ao administrador master.')}>Cadastre-se</button>
                    </p>
                  </form>
                </Form>
              </div>
            ) : (
              <div key="change-password-form" className="space-y-6">
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight">Primeiro Acesso</h2>
                  <p className="text-slate-500 font-medium">Por segurança, você precisa definir uma nova senha.</p>
                </div>

                {error && (
                  <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 text-sm font-medium">
                    {error}
                  </div>
                )}

                <Form {...changePasswordForm}>
                  <form onSubmit={changePasswordForm.handleSubmit(onChangePasswordSubmit)} className="space-y-5">
                      <FormField
                        control={changePasswordForm.control}
                        name="newPassword"
                        render={({ field }) => (
                          <FormItem className="space-y-2">
                            <FormLabel className="text-slate-700 font-semibold">Nova Senha</FormLabel>
                            <div className="relative">
                              <LockIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none z-10" />
                              <FormControl>
                                <Input 
                                  {...field}
                                  type={showNewPassword ? "text" : "password"}
                                  placeholder="Digite sua nova senha" 
                                  autoComplete="new-password"
                                  value={field.value || ""}
                                  className="pl-10 pr-10 h-12 bg-slate-50 border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all rounded-xl"
                                  autoFocus
                                />
                              </FormControl>
                              <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors z-10"
                              >
                                {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                              </button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={changePasswordForm.control}
                        name="confirmPassword"
                        render={({ field }) => (
                          <FormItem className="space-y-2">
                            <FormLabel className="text-slate-700 font-semibold">Confirmar Senha</FormLabel>
                            <div className="relative">
                              <LockIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 pointer-events-none z-10" />
                              <FormControl>
                                <Input 
                                  {...field}
                                  type={showConfirmPassword ? "text" : "password"}
                                  placeholder="Confirme sua nova senha" 
                                  value={field.value || ""}
                                  className="pl-10 pr-10 h-12 bg-slate-50 border-slate-200 focus:bg-white focus:ring-2 focus:ring-blue-500/20 transition-all rounded-xl"
                                />
                              </FormControl>
                              <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors z-10"
                              >
                                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                              </button>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                    <Button 
                      type="submit" 
                      className="w-full h-12 bg-[#1a355b] hover:bg-[#1a355b]/90 text-white font-bold rounded-xl transition-all active:scale-[0.98]"
                      disabled={loading}
                    >
                      {loading ? <Loader2 className="animate-spin" /> : "Salvar e Continuar"}
                    </Button>
                    
                    <Button 
                      variant="ghost" 
                      onClick={() => setIsFirstLogin(false)} 
                      className="w-full text-slate-400 font-medium"
                      type="button"
                    >
                      Voltar ao login
                    </Button>
                  </form>
                </Form>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
