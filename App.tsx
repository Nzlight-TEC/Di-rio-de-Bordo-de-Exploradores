import NetInfo from '@react-native-community/netinfo';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { CATEGORIES, MAX_PHOTOS_PER_DISCOVERY } from './src/constants';
import { canAddPhoto, persistCapturedPhoto } from './src/services/photoStorage';
import { syncPendingDiscoveries, type SyncResult } from './src/services/syncEngine';
import {
  createDiscovery,
  getDashboardMetrics,
  getDatabase,
  listDiscoveries,
  toggleFavorite
} from './src/storage/database';
import type { DashboardMetrics, Discovery, DiscoveryCategory, DiscoveryFilter } from './src/types';

type TabKey = 'dashboard' | 'new' | 'records' | 'sync';

const initialMetrics: DashboardMetrics = {
  total: 0,
  synced: 0,
  pending: 0,
  conflicted: 0,
  byCategory: []
};

const initialFilter: DiscoveryFilter = {
  search: '',
  favoritesOnly: false
};

export default function App(): JSX.Element {
  return (
    <SafeAreaProvider>
      <ExplorerApp />
    </SafeAreaProvider>
  );
}

function ExplorerApp(): JSX.Element {
  const [ready, setReady] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [discoveries, setDiscoveries] = useState<Discovery[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>(initialMetrics);
  const [filter, setFilter] = useState<DiscoveryFilter>(initialFilter);
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<SyncResult | null>(null);

  const refresh = useCallback(async () => {
    const [nextDiscoveries, nextMetrics] = await Promise.all([
      listDiscoveries(filter),
      getDashboardMetrics()
    ]);
    setDiscoveries(nextDiscoveries);
    setMetrics(nextMetrics);
  }, [filter]);

  useEffect(() => {
    let mounted = true;
    getDatabase()
      .then(() => {
        if (mounted) {
          setReady(true);
        }
      })
      .catch((error) => {
        Alert.alert('Erro ao abrir banco local', getErrorMessage(error));
      });

    const unsubscribe = NetInfo.addEventListener((state) => {
      setOnline(Boolean(state.isConnected && state.isInternetReachable !== false));
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (ready) {
      refresh().catch((error) => {
        Alert.alert('Erro ao carregar dados locais', getErrorMessage(error));
      });
    }
  }, [ready, refresh]);

  const syncedPercent = useMemo(() => {
    if (metrics.total === 0) {
      return 0;
    }
    return Math.round((metrics.synced / metrics.total) * 100);
  }, [metrics.synced, metrics.total]);

  const onCreateDiscovery = async (
    title: string,
    description: string,
    category: DiscoveryCategory,
    photoUris: string[]
  ) => {
    await createDiscovery({ title, description, category, photoUris });
    await refresh();
    setActiveTab('records');
  };

  const onToggleFavorite = async (discovery: Discovery) => {
    await toggleFavorite(discovery.id, !discovery.favorite);
    await refresh();
  };

  const onSync = async () => {
    setSyncing(true);
    try {
      const result = await syncPendingDiscoveries();
      setLastSync(result);
      await refresh();
    } catch (error) {
      Alert.alert('Erro de sincronizacao', getErrorMessage(error));
    } finally {
      setSyncing(false);
    }
  };

  if (!ready) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#116466" />
        <Text style={styles.loadingText}>Preparando banco offline...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>Diario de Bordo</Text>
          <Text style={styles.subtitle}>Expedicoes offline-first</Text>
        </View>
        <View style={[styles.connectionBadge, online ? styles.onlineBadge : styles.offlineBadge]}>
          <Ionicons
            name={online ? 'cloud-done-outline' : 'cloud-offline-outline'}
            size={16}
            color={online ? '#0f5c38' : '#7b341e'}
          />
          <Text style={[styles.connectionText, online ? styles.onlineText : styles.offlineText]}>
            {online ? 'Online' : 'Offline'}
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        {activeTab === 'dashboard' && (
          <DashboardView metrics={metrics} syncedPercent={syncedPercent} />
        )}
        {activeTab === 'new' && <DiscoveryForm onSubmit={onCreateDiscovery} />}
        {activeTab === 'records' && (
          <RecordsView
            discoveries={discoveries}
            filter={filter}
            onFilterChange={setFilter}
            onToggleFavorite={onToggleFavorite}
          />
        )}
        {activeTab === 'sync' && (
          <SyncView
            metrics={metrics}
            online={online}
            syncing={syncing}
            lastSync={lastSync}
            onSync={onSync}
          />
        )}
      </View>

      <TabBar activeTab={activeTab} onChange={setActiveTab} />
    </SafeAreaView>
  );
}

function DashboardView({
  metrics,
  syncedPercent
}: {
  metrics: DashboardMetrics;
  syncedPercent: number;
}): JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <View style={styles.metricGrid}>
        <MetricCard icon="compass-outline" label="Descobertas" value={String(metrics.total)} />
        <MetricCard icon="sync-outline" label="Sincronizadas" value={`${syncedPercent}%`} />
        <MetricCard icon="time-outline" label="Pendentes" value={String(metrics.pending)} />
        <MetricCard icon="warning-outline" label="Conflitos" value={String(metrics.conflicted)} />
      </View>

      <Text style={styles.sectionTitle}>Categorias</Text>
      <View style={styles.panel}>
        {metrics.byCategory.length === 0 ? (
          <EmptyState text="Nenhuma descoberta registrada ainda." />
        ) : (
          metrics.byCategory.map((item) => (
            <View key={item.category} style={styles.categoryRow}>
              <Text style={styles.categoryLabel}>{getCategoryLabel(item.category)}</Text>
              <View style={styles.categoryBarTrack}>
                <View
                  style={[
                    styles.categoryBar,
                    { width: `${Math.max(8, (item.count / metrics.total) * 100)}%` }
                  ]}
                />
              </View>
              <Text style={styles.categoryCount}>{item.count}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function DiscoveryForm({
  onSubmit
}: {
  onSubmit: (
    title: string,
    description: string,
    category: DiscoveryCategory,
    photoUris: string[]
  ) => Promise<void>;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<DiscoveryCategory>('flora');
  const [photoUris, setPhotoUris] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const capturePhoto = async () => {
    if (!canAddPhoto(photoUris.length)) {
      Alert.alert('Limite atingido', `Cada descoberta pode ter ate ${MAX_PHOTOS_PER_DISCOVERY} fotos.`);
      return;
    }

    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera bloqueada', 'Autorize o acesso a camera para registrar fotos em campo.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.82,
      allowsEditing: false
    });

    if (!result.canceled && result.assets[0]?.uri) {
      const storedUri = await persistCapturedPhoto(result.assets[0].uri);
      setPhotoUris((current) => [...current, storedUri]);
    }
  };

  const submit = async () => {
    if (!title.trim() || !description.trim()) {
      Alert.alert('Dados obrigatorios', 'Informe titulo e descricao da descoberta.');
      return;
    }

    setSaving(true);
    try {
      await onSubmit(title, description, category, photoUris);
      setTitle('');
      setDescription('');
      setCategory('flora');
      setPhotoUris([]);
    } catch (error) {
      Alert.alert('Erro ao salvar localmente', getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: 'padding', android: undefined })}
      style={styles.formContainer}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.sectionTitle}>Nova descoberta</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Titulo"
          style={styles.input}
          maxLength={80}
        />
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Descricao observada em campo"
          style={[styles.input, styles.textArea]}
          multiline
          textAlignVertical="top"
          maxLength={800}
        />

        <Text style={styles.fieldLabel}>Categoria</Text>
        <View style={styles.choiceGrid}>
          {CATEGORIES.map((item) => (
            <Pressable
              key={item.value}
              onPress={() => setCategory(item.value)}
              style={[styles.choice, category === item.value && styles.choiceActive]}
            >
              <Text style={[styles.choiceText, category === item.value && styles.choiceTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.photoHeader}>
          <Text style={styles.fieldLabel}>Fotos ({photoUris.length}/{MAX_PHOTOS_PER_DISCOVERY})</Text>
          <Pressable style={styles.iconButton} onPress={capturePhoto}>
            <Ionicons name="camera-outline" size={20} color="#ffffff" />
          </Pressable>
        </View>
        <View style={styles.photoStrip}>
          {photoUris.map((uri) => (
            <Image key={uri} source={{ uri }} style={styles.photoThumb} />
          ))}
          {photoUris.length === 0 && <Text style={styles.mutedText}>Sem fotos anexadas.</Text>}
        </View>

        <Pressable
          disabled={saving}
          onPress={submit}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.buttonPressed,
            saving && styles.disabledButton
          ]}
        >
          {saving ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Ionicons name="save-outline" size={20} color="#ffffff" />
              <Text style={styles.primaryButtonText}>Salvar offline</Text>
            </>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function RecordsView({
  discoveries,
  filter,
  onFilterChange,
  onToggleFavorite
}: {
  discoveries: Discovery[];
  filter: DiscoveryFilter;
  onFilterChange: (filter: DiscoveryFilter) => void;
  onToggleFavorite: (discovery: Discovery) => Promise<void>;
}): JSX.Element {
  return (
    <View style={styles.recordsContainer}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color="#5c6670" />
          <TextInput
            value={filter.search}
            onChangeText={(search) => onFilterChange({ ...filter, search })}
            placeholder="Buscar no banco local"
            style={styles.searchInput}
          />
        </View>
        <Pressable
          onPress={() => onFilterChange({ ...filter, favoritesOnly: !filter.favoritesOnly })}
          style={[styles.favoriteFilter, filter.favoritesOnly && styles.favoriteFilterActive]}
        >
          <Ionicons
            name={filter.favoritesOnly ? 'star' : 'star-outline'}
            size={20}
            color={filter.favoritesOnly ? '#5a3d00' : '#374151'}
          />
        </Pressable>
      </View>

      <FlatList
        data={discoveries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<EmptyState text="Nenhum registro encontrado no dispositivo." />}
        renderItem={({ item }) => (
          <DiscoveryCard discovery={item} onToggleFavorite={() => onToggleFavorite(item)} />
        )}
      />
    </View>
  );
}

function DiscoveryCard({
  discovery,
  onToggleFavorite
}: {
  discovery: Discovery;
  onToggleFavorite: () => void;
}): JSX.Element {
  return (
    <View style={styles.discoveryCard}>
      <View style={styles.cardTopRow}>
        <View style={styles.cardTitleBlock}>
          <Text style={styles.discoveryTitle}>{discovery.title}</Text>
          <Text style={styles.discoveryMeta}>
            {getCategoryLabel(discovery.category)} · {formatDate(discovery.discoveredAt)}
          </Text>
        </View>
        <Pressable onPress={onToggleFavorite} style={styles.favoriteButton}>
          <Ionicons
            name={discovery.favorite ? 'star' : 'star-outline'}
            size={24}
            color={discovery.favorite ? '#c88719' : '#52616b'}
          />
        </Pressable>
      </View>
      <Text style={styles.discoveryDescription}>{discovery.description}</Text>
      {discovery.photos.length > 0 && (
        <View style={styles.cardPhotoStrip}>
          {discovery.photos.map((photo) => (
            <Image key={photo.id} source={{ uri: photo.uri }} style={styles.cardPhoto} />
          ))}
        </View>
      )}
      <View style={styles.statusRow}>
        <StatusPill status={discovery.syncStatus} />
        {discovery.syncError ? <Text style={styles.errorText}>{discovery.syncError}</Text> : null}
        {discovery.conflictNote ? <Text style={styles.errorText}>{discovery.conflictNote}</Text> : null}
      </View>
    </View>
  );
}

function SyncView({
  metrics,
  online,
  syncing,
  lastSync,
  onSync
}: {
  metrics: DashboardMetrics;
  online: boolean;
  syncing: boolean;
  lastSync: SyncResult | null;
  onSync: () => Promise<void>;
}): JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <Text style={styles.sectionTitle}>Sincronizacao segura</Text>
      <View style={styles.panel}>
        <Text style={styles.syncLead}>
          A fila local preserva registros criados sem internet e envia em lote quando ha conexao.
        </Text>
        <View style={styles.syncStats}>
          <MetricCard icon="cloud-upload-outline" label="Na fila" value={String(metrics.pending)} />
          <MetricCard icon="shield-checkmark-outline" label="Enviados" value={String(metrics.synced)} />
        </View>
        <Pressable
          disabled={syncing}
          onPress={onSync}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.buttonPressed,
            syncing && styles.disabledButton
          ]}
        >
          {syncing ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <>
              <Ionicons name={online ? 'sync-outline' : 'cloud-offline-outline'} size={20} color="#ffffff" />
              <Text style={styles.primaryButtonText}>
                {online ? 'Sincronizar agora' : 'Verificar fila offline'}
              </Text>
            </>
          )}
        </Pressable>
        {lastSync && (
          <View style={styles.syncResult}>
            <Text style={styles.syncResultTitle}>{lastSync.message}</Text>
            <Text style={styles.mutedText}>
              Tentados {lastSync.attempted} · Enviados {lastSync.synced} · Conflitos{' '}
              {lastSync.conflicts} · Falhas {lastSync.failed}
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function TabBar({
  activeTab,
  onChange
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}): JSX.Element {
  const tabs: Array<{ key: TabKey; icon: keyof typeof Ionicons.glyphMap; label: string }> = [
    { key: 'dashboard', icon: 'analytics-outline', label: 'Painel' },
    { key: 'new', icon: 'add-circle-outline', label: 'Novo' },
    { key: 'records', icon: 'list-outline', label: 'Registros' },
    { key: 'sync', icon: 'cloud-upload-outline', label: 'Sync' }
  ];

  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const active = activeTab === tab.key;
        return (
          <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={styles.tabButton}>
            <Ionicons name={tab.icon} size={22} color={active ? '#116466' : '#64748b'} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MetricCard({
  icon,
  label,
  value
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}): JSX.Element {
  return (
    <View style={styles.metricCard}>
      <Ionicons name={icon} size={21} color="#116466" />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function StatusPill({ status }: { status: Discovery['syncStatus'] }): JSX.Element {
  const config = {
    pending: { label: 'Pendente', color: '#7b341e', bg: '#fff1e6' },
    syncing: { label: 'Enviando', color: '#1d4ed8', bg: '#e6f0ff' },
    synced: { label: 'Sincronizado', color: '#0f5c38', bg: '#e6f6ef' },
    conflict: { label: 'Conflito', color: '#7c2d12', bg: '#ffedd5' },
    error: { label: 'Erro', color: '#991b1b', bg: '#fee2e2' }
  }[status];

  return (
    <View style={[styles.statusPill, { backgroundColor: config.bg }]}>
      <Text style={[styles.statusPillText, { color: config.color }]}>{config.label}</Text>
    </View>
  );
}

function EmptyState({ text }: { text: string }): JSX.Element {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="file-tray-outline" size={28} color="#8a99a8" />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function getCategoryLabel(category: DiscoveryCategory): string {
  return CATEGORIES.find((item) => item.value === category)?.label ?? category;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Erro inesperado.';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f7f3ea'
  },
  loadingScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f3ea'
  },
  loadingText: {
    marginTop: 12,
    color: '#34444d',
    fontSize: 15
  },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomColor: '#ded8c9',
    borderBottomWidth: 1
  },
  appName: {
    color: '#17252a',
    fontSize: 24,
    fontWeight: '800'
  },
  subtitle: {
    color: '#52616b',
    fontSize: 13,
    marginTop: 2
  },
  connectionBadge: {
    minHeight: 32,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  onlineBadge: {
    backgroundColor: '#dff3e8'
  },
  offlineBadge: {
    backgroundColor: '#ffe6d3'
  },
  connectionText: {
    fontSize: 12,
    fontWeight: '700'
  },
  onlineText: {
    color: '#0f5c38'
  },
  offlineText: {
    color: '#7b341e'
  },
  content: {
    flex: 1
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 28
  },
  sectionTitle: {
    color: '#17252a',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20
  },
  metricCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e2ddd0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    width: '48%',
    minHeight: 108,
    justifyContent: 'space-between'
  },
  metricValue: {
    color: '#17252a',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 8
  },
  metricLabel: {
    color: '#52616b',
    fontSize: 12,
    fontWeight: '700'
  },
  panel: {
    backgroundColor: '#ffffff',
    borderColor: '#e2ddd0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 34,
    gap: 10
  },
  categoryLabel: {
    width: 78,
    color: '#34444d',
    fontWeight: '700'
  },
  categoryBarTrack: {
    flex: 1,
    height: 9,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden'
  },
  categoryBar: {
    height: '100%',
    backgroundColor: '#116466'
  },
  categoryCount: {
    color: '#17252a',
    width: 28,
    textAlign: 'right',
    fontWeight: '800'
  },
  formContainer: {
    flex: 1
  },
  input: {
    backgroundColor: '#ffffff',
    borderColor: '#d9d2c1',
    borderWidth: 1,
    borderRadius: 8,
    color: '#17252a',
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: 12,
    marginBottom: 12
  },
  textArea: {
    minHeight: 128,
    paddingTop: 12
  },
  fieldLabel: {
    color: '#34444d',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 8
  },
  choiceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16
  },
  choice: {
    borderRadius: 8,
    borderColor: '#d8d0bd',
    borderWidth: 1,
    backgroundColor: '#ffffff',
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 12
  },
  choiceActive: {
    backgroundColor: '#dff3e8',
    borderColor: '#116466'
  },
  choiceText: {
    color: '#34444d',
    fontWeight: '700'
  },
  choiceTextActive: {
    color: '#0f5c38'
  },
  photoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#116466',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8
  },
  photoStrip: {
    minHeight: 78,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginBottom: 18
  },
  photoThumb: {
    width: 74,
    height: 74,
    borderRadius: 8,
    backgroundColor: '#dfe7ea'
  },
  primaryButton: {
    minHeight: 50,
    borderRadius: 8,
    backgroundColor: '#116466',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15
  },
  buttonPressed: {
    opacity: 0.82
  },
  disabledButton: {
    opacity: 0.58
  },
  recordsContainer: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12
  },
  searchBox: {
    flex: 1,
    minHeight: 46,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d9d2c1',
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    gap: 8
  },
  searchInput: {
    flex: 1,
    color: '#17252a',
    fontSize: 15
  },
  favoriteFilter: {
    width: 46,
    height: 46,
    borderRadius: 8,
    borderColor: '#d9d2c1',
    borderWidth: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center'
  },
  favoriteFilterActive: {
    backgroundColor: '#ffe9ad',
    borderColor: '#c88719'
  },
  listContent: {
    paddingBottom: 24,
    gap: 12
  },
  discoveryCard: {
    backgroundColor: '#ffffff',
    borderColor: '#e2ddd0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 14
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8
  },
  cardTitleBlock: {
    flex: 1
  },
  discoveryTitle: {
    color: '#17252a',
    fontSize: 17,
    fontWeight: '800'
  },
  discoveryMeta: {
    color: '#52616b',
    marginTop: 2,
    fontSize: 12,
    fontWeight: '700'
  },
  favoriteButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center'
  },
  discoveryDescription: {
    color: '#34444d',
    lineHeight: 20,
    marginTop: 10
  },
  cardPhotoStrip: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12
  },
  cardPhoto: {
    width: 58,
    height: 58,
    borderRadius: 8,
    backgroundColor: '#dfe7ea'
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    flexWrap: 'wrap'
  },
  statusPill: {
    minHeight: 28,
    borderRadius: 8,
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  statusPillText: {
    fontWeight: '800',
    fontSize: 12
  },
  errorText: {
    color: '#991b1b',
    flexShrink: 1,
    fontSize: 12
  },
  syncLead: {
    color: '#34444d',
    lineHeight: 21,
    marginBottom: 14
  },
  syncStats: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14
  },
  syncResult: {
    marginTop: 14,
    borderTopColor: '#e2ddd0',
    borderTopWidth: 1,
    paddingTop: 12
  },
  syncResultTitle: {
    color: '#17252a',
    fontWeight: '800',
    marginBottom: 4
  },
  mutedText: {
    color: '#66757f'
  },
  emptyState: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 16
  },
  emptyText: {
    color: '#66757f',
    textAlign: 'center'
  },
  tabBar: {
    minHeight: 66,
    borderTopColor: '#ded8c9',
    borderTopWidth: 1,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: 4
  },
  tabButton: {
    minWidth: 72,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3
  },
  tabLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '800'
  },
  tabLabelActive: {
    color: '#116466'
  }
});
