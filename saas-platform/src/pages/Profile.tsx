import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { User, Mail, Camera, Save, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface UserProfile {
  full_name: string;
  email: string;
  avatar_url: string;
}

export default function Profile() {
  const [profile, setProfile] = useState<UserProfile>({
    full_name: '',
    email: '',
    avatar_url: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const response = await fetch('/api/v1/profile', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setProfile(data);
      }
    } catch {
      toast.error('Erro ao carregar perfil');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/v1/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          full_name: profile.full_name,
          avatar_url: profile.avatar_url
        })
      });

      if (response.ok) {
        toast.success('Perfil atualizado com sucesso!');
      } else {
        toast.error('Erro ao atualizar perfil');
      }
    } catch {
      toast.error('Erro de conexão');
    } finally {
      setSaving(false);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .substring(0, 2);
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-4 sm:p-0 max-w-2xl mx-auto space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Meu Perfil</h1>
        <p className="text-slate-500 font-medium text-sm sm:text-base">Gerencie suas informações pessoais e avatar.</p>
      </div>

      <Card className="border-none shadow-sm sm:shadow-md rounded-[24px] overflow-hidden">
        <CardHeader className="pb-4 border-b border-border">
          <CardTitle className="text-lg font-bold">Informações Pessoais</CardTitle>
          <CardDescription className="text-xs font-medium">Esses dados serão visíveis para outros membros da sua organização.</CardDescription>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 space-y-8">
          <div className="flex flex-col items-center gap-6 sm:flex-row">
            <div className="relative group">
              <Avatar className="h-28 w-28 sm:h-24 sm:w-24 border-4 border-white shadow-xl group-hover:scale-105 transition-transform duration-300">
                <AvatarImage src={profile.avatar_url} className="object-cover" />
                <AvatarFallback className="bg-gradient-to-br from-orange-100 to-orange-200 text-orange-700 text-3xl font-black">
                  {getInitials(profile.full_name || 'User')}
                </AvatarFallback>
              </Avatar>
              <Button 
                size="icon" 
                variant="secondary" 
                className="absolute -bottom-1 -right-1 rounded-2xl h-10 w-10 shadow-lg border-2 border-white bg-white hover:bg-slate-50 text-slate-600 transition-all active:scale-90"
                onClick={() => {
                  const url = prompt('Insira a URL da imagem para o avatar:', profile.avatar_url);
                  if (url !== null) setProfile({...profile, avatar_url: url});
                }}
              >
                <Camera className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 space-y-1.5 text-center sm:text-left">
              <h3 className="font-bold text-xl text-slate-900">{profile.full_name || 'Seu Nome'}</h3>
              <div className="flex items-center justify-center sm:justify-start gap-2 text-slate-500">
                <Mail className="h-3.5 w-3.5" />
                <p className="text-sm font-medium">{profile.email}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="space-y-2.5">
              <Label htmlFor="full_name" className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Nome Completo</Label>
              <div className="relative group">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                <Input 
                  id="full_name" 
                  className="pl-11 h-12 bg-slate-50/50 border-none rounded-2xl focus-visible:ring-2 focus-visible:ring-orange-500/20 transition-all" 
                  value={profile.full_name}
                  onChange={(e) => setProfile({...profile, full_name: e.target.value})}
                  placeholder="Seu nome completo"
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <Label htmlFor="email" className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">E-mail (Não alterável)</Label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300" />
                <Input 
                  id="email" 
                  className="pl-11 h-12 bg-slate-100 border-none rounded-2xl text-slate-400 cursor-not-allowed" 
                  value={profile.email} 
                  disabled 
                />
              </div>
            </div>

            <div className="space-y-2.5">
              <Label htmlFor="avatar_url" className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">URL do Avatar</Label>
              <Input 
                id="avatar_url" 
                placeholder="https://exemplo.com/avatar.jpg"
                className="h-12 bg-slate-50/50 border-none rounded-2xl focus-visible:ring-2 focus-visible:ring-orange-500/20 transition-all"
                value={profile.avatar_url}
                onChange={(e) => setProfile({...profile, avatar_url: e.target.value})}
              />
            </div>
          </div>

          <div className="flex justify-end pt-4">
            <Button 
              onClick={handleSave} 
              disabled={saving} 
              className="w-full sm:w-auto h-12 px-8 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-2xl shadow-lg shadow-orange-200 transition-all active:scale-[0.98]"
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar Alterações
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
