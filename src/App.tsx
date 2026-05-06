import React, { useState, useRef, useEffect } from 'react';
import { Upload, Search, User, Image as ImageIcon, CheckCircle2, AlertCircle, Loader2, FolderOpen, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { toast, Toaster } from 'sonner';
import { loadModels, getFaceDescriptor, getAllFaceDescriptors, computeDistance } from './lib/faceApi';
import { cn } from './lib/utils';

interface FaceData {
  id: string;
  name: string;
  location: string;
  file?: File;
  fileUrl?: string;
  descriptors: Float32Array[];
}

const API_BASE = '/api';

interface GalleryItem {
  id: string;
  name: string;
  url: string;
}

export default function App() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [targetImage, setTargetImage] = useState<string | null>(null);
  const [targetDescriptor, setTargetDescriptor] = useState<Float32Array | null>(null);
  const [isProcessingTarget, setIsProcessingTarget] = useState(false);
  
  const [gallery, setGallery] = useState<FaceData[]>([]);
  const [galleryPreviews, setGalleryPreviews] = useState<GalleryItem[]>([]);
  const [isProcessingGallery, setIsProcessingGallery] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  
  const [bestMatch, setBestMatch] = useState<(FaceData & { distance: number }) | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gallerySearchTerm, setGallerySearchTerm] = useState('');
  const [isManagementMode, setIsManagementMode] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<FaceData[][]>([]);
  const [isFindingDuplicates, setIsFindingDuplicates] = useState(false);
  const [isGroupedView, setIsGroupedView] = useState(false);
  const [showOnlyTwoPeople, setShowOnlyTwoPeople] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const galleryFilesInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const init = async () => {
      try {
        await loadModels();
        setIsLoaded(true);

        // Load saved gallery from API
        const res = await fetch(`${API_BASE}/gallery`);
        if (res.ok) {
          const data = await res.json();
          const migratedGallery = data.map((item: any) => ({
            ...item,
            descriptors: item.descriptors?.map((d: any) => new Float32Array(d)) || []
          }));
          setGallery(migratedGallery);
          const previews: GalleryItem[] = migratedGallery.slice(0, 50).map((item: any) => ({
            id: item.id,
            name: item.name,
            url: `${item.fileUrl}`
          }));
          setGalleryPreviews(previews);
        }
      } catch (err) {
        setError('Failed to load face recognition models or saved database.');
        console.error(err);
      }
    };
    init();
  }, []);

  const clearDatabase = async () => {
    if (window.confirm('Are you sure you want to clear the entire face database?')) {
      await fetch(`${API_BASE}/gallery`, { method: 'DELETE' });
      setGallery([]);
      setGalleryPreviews([]);
      setBestMatch(null);
      setHasSearched(false);
      toast.success('Database cleared successfully');
    }
  };

  const deleteGalleryItem = async (id: string) => {
    const updated = gallery.filter(item => item.id !== id);
    setGallery(updated);
    setGalleryPreviews(prev => prev.filter(item => item.id !== id));
    await fetch(`${API_BASE}/gallery/${id}`, { method: 'DELETE' });
    toast.success('Item removed from database');
  };

  const deduplicateDatabase = async () => {
    const seen = new Set<string>();
    const unique: FaceData[] = [];
    let removedCount = 0;

    for (const item of gallery) {
      const key = `${item.name}-${item.file.size}`;
      if (seen.has(key)) {
        removedCount++;
        continue;
      }
      seen.add(key);
      unique.push(item);
    }

    if (removedCount > 0) {
      setGallery(unique);
      // Update previews to match unique items
      const uniqueIds = new Set(unique.map(u => u.id));
      setGalleryPreviews(prev => prev.filter(p => uniqueIds.has(p.id)));
      await set('face-gallery', unique);
      toast.success(`Removed ${removedCount} duplicate records`);
    } else {
      toast.info('No duplicates found in database');
    }
  };

  const findDuplicateFaces = async () => {
    if (gallery.length < 2) return;
    
    setIsFindingDuplicates(true);
    setDuplicateGroups([]);
    
    // Small delay to allow UI to update
    await new Promise(resolve => setTimeout(resolve, 100));

    const groups: FaceData[][] = [];
    const processed = new Set<string>();

    for (let i = 0; i < gallery.length; i++) {
      if (processed.has(gallery[i].id)) continue;

      const currentGroup: FaceData[] = [gallery[i]];
      processed.add(gallery[i].id);

      for (let j = i + 1; j < gallery.length; j++) {
        if (processed.has(gallery[j].id)) continue;

        // Compare first face for duplicate detection
        const distance = computeDistance(gallery[i].descriptors?.[0], gallery[j].descriptors?.[0]);
        // Using a strict threshold for "duplicates" (0.4)
        if (distance < 0.4) {
          currentGroup.push(gallery[j]);
          processed.add(gallery[j].id);
        }
      }

      if (currentGroup.length > 1) {
        groups.push(currentGroup);
      }
    }

    setDuplicateGroups(groups);
    setIsFindingDuplicates(false);
    
    if (groups.length > 0) {
      toast.success(`Found ${groups.length} groups of similar faces`);
    } else {
      toast.info('No visually similar faces found');
    }
  };

  const getGroupedGallery = () => {
    if (gallery.length === 0) return [];
    
    const groups: FaceData[][] = [];
    const processed = new Set<string>();

    for (let i = 0; i < gallery.length; i++) {
      if (processed.has(gallery[i].id)) continue;

      const currentGroup: FaceData[] = [gallery[i]];
      processed.add(gallery[i].id);

      for (let j = i + 1; j < gallery.length; j++) {
        if (processed.has(gallery[j].id)) continue;

        // Basic grouping by first face
        const distance = computeDistance(gallery[i].descriptors?.[0], gallery[j].descriptors?.[0]);
        // Using 0.45 as a balanced threshold for grouping same person
        if (distance < 0.45) {
          currentGroup.push(gallery[j]);
          processed.add(gallery[j].id);
        }
      }
      groups.push(currentGroup);
    }
    
    // Sort groups by size (largest first)
    return groups.sort((a, b) => b.length - a.length);
  };

  const handleTargetUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setIsProcessingTarget(true);
    setBestMatch(null);
    setHasSearched(false);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const imgUrl = event.target?.result as string;
      setTargetImage(imgUrl);

      const img = new Image();
      img.src = imgUrl;
      await img.decode();

      const descriptor = await getFaceDescriptor(img);
      if (descriptor) {
        setTargetDescriptor(descriptor);
      } else {
        setError('No face detected in the target image. Please try another photo.');
        setTargetImage(null);
      }
      setIsProcessingTarget(false);
    };
    reader.readAsDataURL(file);
  };

  const processFiles = async (files: File[]) => {
    if (files.length === 0) return;

    setIsProcessingGallery(true);
    setProgress({ current: 0, total: files.length });
    
    const formData = new FormData();
    const descriptorsMap: Record<string, number[][]> = {};
    const locationsMap: Record<string, string> = {};

    // @ts-ignore
    const existingKeys = new Set(gallery.map(item => `${item.name}-${item.file?.size || item.size || 0}`));
    
    let processedCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileKey = `${file.name}-${file.size}`;
      
      if (existingKeys.has(fileKey)) {
        setProgress({ current: i + 1, total: files.length });
        continue;
      }

      try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.src = url;
        
        const isImage = await new Promise((resolve) => {
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
        });

        if (isImage) {
          const descriptors = await getAllFaceDescriptors(img);
          if (descriptors.length > 0) {
            formData.append('files', file);
            descriptorsMap[file.name] = descriptors.map(d => Array.from(d));
            locationsMap[file.name] = file.webkitRelativePath || file.name;
          }
        }
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error(`Error processing ${file.name}:`, err);
      }
      setProgress({ current: i + 1, total: files.length });
      processedCount++;
    }

    if (processedCount > 0 && formData.has('files')) {
      formData.append('descriptors', JSON.stringify(descriptorsMap));
      formData.append('locations', JSON.stringify(locationsMap));
      
      try {
        const res = await fetch(`${API_BASE}/gallery`, {
          method: 'POST',
          body: formData
        });
        const result = await res.json();
        
        if (result.success) {
          const newItems = result.items.map((item: any) => ({
            ...item,
            descriptors: item.descriptors.map((d: any) => new Float32Array(d))
          }));
          
          setGallery(prev => [...prev, ...newItems]);
          setGalleryPreviews(prev => {
            const newPreviews = newItems.map((item: any) => ({
              id: item.id,
              name: item.name,
              url: `${item.fileUrl}`
            }));
            return [...prev, ...newPreviews].slice(0, 100);
          });
          toast.success(`Added ${newItems.length} new images to database`);
        }
      } catch (err) {
        console.error('Upload failed', err);
        toast.error('Failed to upload images to server');
      }
    } else if (files.length > 0) {
      toast.info('No new unique images found');
    }
    
    setIsProcessingGallery(false);
  };

  const handleFolderUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    await processFiles(files);
  };

  const handleManualGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    await processFiles(files);
  };

  const startSearch = async () => {
    if (!targetDescriptor || gallery.length === 0) return;

    setIsSearching(true);
    setHasSearched(true);
    setBestMatch(null);
    setError(null);

    // Small delay to allow loader to show
    await new Promise(resolve => setTimeout(resolve, 100));

    let minDistance = Infinity;
    let match: FaceData | null = null;

    // High performance loop
    for (let i = 0; i < gallery.length; i++) {
      const item = gallery[i];
      // Check all faces in the image
      const descriptors = item.descriptors || [];
      for (const descriptor of descriptors) {
        const distance = computeDistance(targetDescriptor, descriptor);
        if (distance < minDistance) {
          minDistance = distance;
          match = item;
        }
      }
    }

    if (match && minDistance < 0.6) {
      const matchUrl = match.fileUrl ? `${match.fileUrl}` : (match.file ? URL.createObjectURL(match.file) : '');
      setBestMatch({ 
        ...match, 
        url: matchUrl,
        distance: minDistance 
      });
      toast.success(`Match found: ${match.name}`, {
        description: `Similarity: ${((1 - minDistance) * 100).toFixed(1)}%`,
        icon: <CheckCircle2 className="w-5 h-5 text-green-500" />
      });
    } else {
      toast.error('No Match Found', {
        description: 'The subject was not found in the database.',
        icon: <AlertCircle className="w-5 h-5 text-red-500" />
      });
    }
    setIsSearching(false);
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center text-white font-sans">
        <Loader2 className="w-12 h-12 animate-spin text-blue-500 mb-4" />
        <p className="text-zinc-400 animate-pulse">Initializing Neural Networks...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 selection:bg-blue-500/30">
      <Toaster position="top-center" expand={true} richColors theme="dark" />
      {/* Header */}
      <header className="border-b border-zinc-800/50 bg-black/40 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Search className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight leading-none">FaceMatch <span className="text-blue-500">AI</span></h1>
              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-[0.2em] mt-1">Neural Engine v2.5</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-4">
            <div className="px-3 py-1 rounded-full bg-zinc-800/30 border border-zinc-700/30 text-[10px] font-mono text-zinc-400 tracking-wider">
              {gallery.length.toLocaleString()} IMAGES INDEXED
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 md:gap-12">
          
          {/* Left Column: Target & Controls */}
          <div className="lg:col-span-4 space-y-8">
            <section className="space-y-4">
              <h2 className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.15em] flex items-center gap-2">
                <User className="w-3.5 h-3.5" /> Target Subject
              </h2>
              
              <div 
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "relative aspect-square rounded-3xl border-2 border-dashed transition-all cursor-pointer overflow-hidden group glass",
                  targetImage ? "border-blue-500/30" : "border-zinc-800 hover:border-zinc-700"
                )}
              >
                {targetImage ? (
                  <>
                    <img src={targetImage} alt="Target" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <p className="text-sm font-medium">Change Image</p>
                    </div>
                  </>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <Upload className="w-8 h-8 text-zinc-400" />
                    </div>
                    <p className="text-sm font-medium text-zinc-300">Upload Target Face</p>
                    <p className="text-xs text-zinc-500 mt-2">Clear portrait works best</p>
                  </div>
                )}
                
                {isProcessingTarget && (
                  <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-2" />
                    <p className="text-xs font-mono">Extracting Descriptors...</p>
                  </div>
                )}
              </div>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleTargetUpload} 
                className="hidden" 
                accept="*" 
              />
            </section>

            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.15em] flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5" /> Database Source
                </h2>
                {gallery.length > 0 && (
                  <button 
                    onClick={clearDatabase}
                    className="text-[9px] font-bold text-red-500/40 hover:text-red-500 uppercase tracking-wider transition-colors"
                  >
                    Clear Database
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3">
                <button 
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isProcessingGallery}
                  className="flex items-center justify-between p-4 rounded-2xl glass hover:bg-zinc-800/40 transition-all disabled:opacity-50 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-zinc-800/50 flex items-center justify-center group-hover:bg-blue-500/10 transition-colors">
                      <FolderOpen className="w-5 h-5 text-zinc-400 group-hover:text-blue-500" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium leading-tight">Import Folder</p>
                      <p className="text-[10px] text-zinc-500 mt-1">Batch process images</p>
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-zinc-600 tracking-widest">DIR</div>
                </button>
                <button 
                  onClick={() => galleryFilesInputRef.current?.click()}
                  disabled={isProcessingGallery}
                  className="flex items-center justify-between p-4 rounded-2xl glass hover:bg-zinc-800/40 transition-all disabled:opacity-50 group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-zinc-800/50 flex items-center justify-center group-hover:bg-blue-500/10 transition-colors">
                      <ImageIcon className="w-5 h-5 text-zinc-400 group-hover:text-blue-500" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium leading-tight">Add Photos</p>
                      <p className="text-[10px] text-zinc-500 mt-1">Select individual files</p>
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-zinc-600 tracking-widest">FILE</div>
                </button>
                <input 
                  type="file" 
                  ref={folderInputRef} 
                  onChange={handleFolderUpload} 
                  className="hidden" 
                  multiple
                  // @ts-ignore - webkitdirectory is non-standard but supported
                  webkitdirectory="" 
                />
                <input 
                  type="file" 
                  ref={galleryFilesInputRef} 
                  onChange={handleManualGalleryUpload} 
                  className="hidden" 
                  multiple
                  accept="*" 
                />
              </div>

              {isProcessingGallery && (
                <div className="p-4 rounded-2xl bg-blue-500/5 border border-blue-500/20 space-y-3">
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-blue-400">INDEXING...</span>
                    <span>{progress.current} / {progress.total}</span>
                  </div>
                  <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-blue-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </section>

            <button
              onClick={startSearch}
              disabled={!targetDescriptor || gallery.length === 0 || isSearching}
              className={cn(
                "w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all",
                targetDescriptor && gallery.length > 0
                  ? "bg-blue-600 hover:bg-blue-500 text-white shadow-xl shadow-blue-500/20"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              )}
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Scanning Database...
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  Run Match Analysis
                </>
              )}
            </button>

            {error && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 flex gap-3"
              >
                <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
                <p className="text-xs text-red-400 leading-relaxed">{error}</p>
              </motion.div>
            )}
          </div>

          {/* Right Column: Results & Gallery */}
          <div className="lg:col-span-8 space-y-12">
            
            {/* Match Result */}
            <section className="space-y-6">
              <h2 className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.15em] flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5" /> Analysis Result
              </h2>
              
              <AnimatePresence mode="wait">
                {isSearching ? (
                  <motion.div 
                    key="searching"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="h-64 rounded-[2rem] glass flex flex-col items-center justify-center overflow-hidden relative"
                  >
                    <div className="absolute inset-0 bg-blue-500/5 animate-pulse" />
                    <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4 relative z-10" />
                    <p className="text-sm font-mono text-blue-400 tracking-[0.2em] relative z-10">Scanning Neural Database...</p>
                  </motion.div>
                ) : bestMatch ? (
                  <motion.div 
                    key="match"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="relative rounded-[2rem] glass-card p-6 md:p-8 overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 p-6 md:p-8">
                      <div className="px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20 text-green-500 text-[9px] font-bold tracking-[0.2em] uppercase">
                        High Confidence Match
                      </div>
                    </div>
                    
                    <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center gap-2">
                          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Target</p>
                          <div className="w-28 h-28 md:w-40 md:h-40 rounded-3xl overflow-hidden border-2 border-zinc-800 shadow-2xl">
                            <img src={targetImage!} alt="Target" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                          <p className="text-[9px] font-bold text-blue-500 uppercase tracking-[0.2em]">Match</p>
                          <div className="w-28 h-28 md:w-40 md:h-40 rounded-3xl overflow-hidden border-2 border-blue-500/40 shadow-2xl">
                            <img src={bestMatch.url} alt="Match" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 space-y-6 text-center md:text-left pt-4">
                        <div className="space-y-4">
                          <div>
                            <h3 className="text-2xl font-bold text-white mb-1 tracking-tight">{bestMatch.name}</h3>
                            <div className="flex items-center justify-center md:justify-start gap-2">
                              <span className="px-2 py-0.5 rounded bg-zinc-800/50 text-[9px] font-mono text-zinc-400 uppercase tracking-widest border border-zinc-700/30">ID: {bestMatch.id}</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3 p-3 rounded-2xl bg-zinc-800/20 border border-zinc-700/20 w-fit mx-auto md:mx-0 max-w-full group">
                            <FolderOpen className="w-4 h-4 text-blue-400 shrink-0" />
                            <div className="flex flex-col text-left">
                              <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-[0.2em] mb-0.5">Storage Location</span>
                              <p className="text-[10px] font-mono text-zinc-400 truncate max-w-[180px] md:max-w-[280px]" title={bestMatch.location}>
                                {bestMatch.location}
                              </p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-4 rounded-2xl bg-zinc-800/30 border border-zinc-700/20">
                            <p className="text-[9px] text-zinc-500 uppercase font-bold tracking-[0.2em] mb-1">Similarity</p>
                            <p className="text-2xl font-bold text-blue-400 tracking-tight">
                              {((1 - bestMatch.distance) * 100).toFixed(1)}%
                            </p>
                          </div>
                          <div className="p-4 rounded-2xl bg-zinc-800/30 border border-zinc-700/20">
                            <p className="text-[9px] text-zinc-500 uppercase font-bold tracking-[0.2em] mb-1">Euclidean</p>
                            <p className="text-2xl font-bold text-zinc-300 tracking-tight">
                              {bestMatch.distance.toFixed(3)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : hasSearched ? (
                  <motion.div 
                    key="no-match"
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="relative rounded-[2rem] glass p-6 md:p-8 overflow-hidden border-red-500/10"
                  >
                    <div className="absolute top-0 right-0 p-6 md:p-8">
                      <div className="px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 text-[9px] font-bold tracking-[0.2em] uppercase">
                        No Match Found
                      </div>
                    </div>
                    
                    <div className="flex flex-col md:flex-row gap-8 items-center md:items-start">
                      <div className="flex gap-4">
                        <div className="flex flex-col items-center gap-2">
                          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Target</p>
                          <div className="w-28 h-28 md:w-40 md:h-40 rounded-3xl overflow-hidden border-2 border-zinc-800 shadow-2xl">
                            <img src={targetImage!} alt="Target" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-2">
                          <p className="text-[9px] font-bold text-red-500 uppercase tracking-[0.2em]">No Match</p>
                          <div className="w-28 h-28 md:w-40 md:h-40 rounded-3xl overflow-hidden border-2 border-zinc-800 bg-zinc-950 flex items-center justify-center">
                            <User className="w-10 h-10 md:w-16 md:h-16 text-zinc-800" />
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 space-y-6 text-center md:text-left pt-4">
                        <div className="space-y-4">
                          <div>
                            <h3 className="text-2xl font-bold text-zinc-500 mb-1 tracking-tight">Unknown Subject</h3>
                            <div className="flex items-center justify-center md:justify-start gap-2">
                              <span className="px-2 py-0.5 rounded bg-zinc-800/50 text-[9px] font-mono text-zinc-600 uppercase tracking-widest border border-zinc-800">ID: NULL_RESULT</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-3 p-3 rounded-2xl bg-red-500/5 border border-red-500/10 w-fit mx-auto md:mx-0">
                            <AlertCircle className="w-4 h-4 text-red-500/50 shrink-0" />
                            <div className="flex flex-col text-left">
                              <span className="text-[8px] font-bold text-red-500/50 uppercase tracking-[0.2em] mb-0.5">Search Status</span>
                              <p className="text-[10px] font-mono text-red-500/40">
                                NO MATCH IN DATABASE
                              </p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="p-4 rounded-2xl bg-zinc-800/10 border border-zinc-800/20">
                            <p className="text-[9px] text-zinc-500 uppercase font-bold tracking-[0.2em] mb-1">Similarity</p>
                            <p className="text-2xl font-bold text-zinc-700 tracking-tight">0.0%</p>
                          </div>
                          <div className="p-4 rounded-2xl bg-zinc-800/10 border border-zinc-800/20">
                            <p className="text-[9px] text-zinc-500 uppercase font-bold tracking-[0.2em] mb-1">Euclidean</p>
                            <p className="text-2xl font-bold text-zinc-700 tracking-tight">1.000</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="h-64 rounded-[2rem] border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center text-zinc-600 overflow-hidden glass"
                  >
                    {targetImage ? (
                      <div className="flex flex-col items-center gap-4">
                        <div className="w-32 h-32 rounded-3xl overflow-hidden border-4 border-zinc-800 shadow-2xl">
                          <img src={targetImage} alt="Target" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        </div>
                        <p className="text-sm font-medium text-zinc-400">Target Loaded. Ready to analyze.</p>
                      </div>
                    ) : (
                      <>
                        <ImageIcon className="w-12 h-12 mb-4 opacity-20" />
                        <p className="text-sm">Upload a target face to begin</p>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>

            {/* Gallery Management */}
            <section className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <h2 className="text-[11px] font-bold text-zinc-500 uppercase tracking-[0.15em] flex items-center gap-2">
                    <ImageIcon className="w-3.5 h-3.5" /> Neural Database Management
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-zinc-800/50 text-[9px] font-mono text-zinc-500 tracking-wider border border-zinc-700/30">
                    {gallery.length} Records
                  </span>
                </div>
                
                <div className="flex items-center gap-2">
                  {gallery.length > 0 && (
                    <>
                      <button 
                        onClick={() => setIsGroupedView(!isGroupedView)}
                        className={cn(
                          "px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-[0.15em] transition-all border",
                          isGroupedView 
                            ? "bg-blue-600 border-blue-500 text-white" 
                            : "bg-zinc-800/50 border-zinc-700/30 text-zinc-400 hover:bg-zinc-700/50"
                        )}
                      >
                        {isGroupedView ? 'View List' : 'Group by Person'}
                      </button>
                      <button 
                        onClick={() => setShowOnlyTwoPeople(!showOnlyTwoPeople)}
                        className={cn(
                          "px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-[0.15em] transition-all border",
                          showOnlyTwoPeople 
                            ? "bg-purple-600 border-purple-500 text-white" 
                            : "bg-zinc-800/50 border-zinc-700/30 text-zinc-400 hover:bg-zinc-700/50"
                        )}
                      >
                        {showOnlyTwoPeople ? 'All Photos' : '2 People Only'}
                      </button>
                      <button 
                        onClick={findDuplicateFaces}
                        disabled={isFindingDuplicates}
                        className="px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-[0.15em] bg-blue-500/10 border border-blue-500/30 text-blue-400 hover:bg-blue-500/20 transition-all disabled:opacity-50"
                      >
                        {isFindingDuplicates ? 'Finding...' : 'Find Duplicates'}
                      </button>
                      <button 
                        onClick={deduplicateDatabase}
                        className="px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-[0.15em] bg-zinc-800/50 border border-zinc-700/30 text-zinc-400 hover:bg-zinc-700/50 transition-all"
                      >
                        Cleanup Files
                      </button>
                    </>
                  )}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500" />
                    <input 
                      type="text" 
                      placeholder="Search records..."
                      value={gallerySearchTerm}
                      onChange={(e) => setGallerySearchTerm(e.target.value)}
                      className="bg-zinc-900/30 border border-zinc-800/50 rounded-full pl-9 pr-4 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-blue-500/30 transition-all w-40 md:w-56 glass"
                    />
                  </div>
                  <button 
                    onClick={() => setIsManagementMode(!isManagementMode)}
                    className={cn(
                      "px-4 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-[0.15em] transition-all border",
                      isManagementMode 
                        ? "bg-red-500/10 border-red-500/30 text-red-500" 
                        : "bg-zinc-800/50 border-zinc-700/30 text-zinc-400 hover:bg-zinc-700/50"
                    )}
                  >
                    {isManagementMode ? 'Exit' : 'Manage'}
                  </button>
                </div>
              </div>

              {gallery.length > 0 ? (
                <div className="space-y-8">
                  {duplicateGroups.length > 0 && !isGroupedView && (
                    <div className="space-y-4 p-6 rounded-[2rem] bg-blue-500/5 border border-blue-500/10">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[10px] font-bold text-blue-400 uppercase tracking-[0.2em] flex items-center gap-2">
                          <AlertCircle className="w-3 h-3" /> Potential Duplicate Groups
                        </h3>
                        <button 
                          onClick={() => setDuplicateGroups([])}
                          className="text-[9px] text-zinc-500 hover:text-zinc-300 uppercase tracking-wider"
                        >
                          Dismiss
                        </button>
                      </div>
                      <div className="space-y-6">
                        {duplicateGroups.map((group, groupIdx) => (
                          <div key={groupIdx} className="space-y-2">
                            <p className="text-[9px] text-zinc-500 font-mono">Group {groupIdx + 1} ({group.length} items)</p>
                            <div className="flex flex-wrap gap-3">
                              {group.map((item) => {
                                const previewUrl = galleryPreviews.find(p => p.id === item.id)?.url || (item.fileUrl ? `${item.fileUrl}` : '');
                                return (
                                  <div key={item.id} className="relative w-16 h-16 rounded-xl overflow-hidden border border-zinc-800 group">
                                    <img src={previewUrl} alt={item.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                    <button 
                                      onClick={() => deleteGalleryItem(item.id)}
                                      className="absolute inset-0 bg-red-500/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                    >
                                      <AlertCircle className="w-4 h-4 text-white" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {isGroupedView ? (
                    <div className="space-y-12">
                      {getGroupedGallery().map((group, groupIdx) => (
                        <div key={groupIdx} className="space-y-4">
                          <div className="flex items-center gap-3 border-b border-zinc-800/50 pb-2">
                            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                              <User className="w-4 h-4 text-blue-500" />
                            </div>
                            <div>
                              <h3 className="text-sm font-bold text-zinc-200">Person {groupIdx + 1}</h3>
                              <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">{group.length} Associated Images</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                            {group.map((item) => {
                              const previewUrl = galleryPreviews.find(p => p.id === item.id)?.url || (item.fileUrl ? `${item.fileUrl}` : '');
                              return (
                                <motion.div 
                                  key={item.id}
                                  layout
                                  initial={{ opacity: 0, scale: 0.9 }}
                                  animate={{ opacity: 1, scale: 1 }}
                                  className="aspect-square rounded-2xl glass overflow-hidden group relative"
                                >
                                  <img 
                                    src={previewUrl} 
                                    alt={item.name} 
                                    className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-all duration-500" 
                                    referrerPolicy="no-referrer" 
                                  />
                                  <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                                    <p className="text-[9px] font-mono truncate text-zinc-300 mb-0.5 tracking-tight">{item.name}</p>
                                    <div className="flex items-center justify-between">
                                      <p className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">ID: {item.id}</p>
                                      <p className="text-[8px] font-mono text-blue-400 font-bold">{(item.descriptors?.length || 0)} Faces</p>
                                    </div>
                                  </div>
                                  
                                  {isManagementMode && (
                                    <button 
                                      onClick={() => deleteGalleryItem(item.id)}
                                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-all shadow-xl hover:bg-red-600"
                                    >
                                      <AlertCircle className="w-3 h-3" />
                                    </button>
                                  )}
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {gallery
                        .filter(item => {
                          const matchesSearch = item.name.toLowerCase().includes(gallerySearchTerm.toLowerCase());
                          const matchesFaceCount = showOnlyTwoPeople ? (item.descriptors?.length === 2) : true;
                          return matchesSearch && matchesFaceCount;
                        })
                        .slice(0, isManagementMode ? 100 : 20)
                        .map((item) => {
                      const previewUrl = galleryPreviews.find(p => p.id === item.id)?.url || (item.fileUrl ? `${item.fileUrl}` : '');
                      
                      return (
                        <motion.div 
                          key={item.id}
                          layout
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="aspect-square rounded-2xl glass overflow-hidden group relative"
                        >
                          <img 
                            src={previewUrl} 
                            alt={item.name} 
                            className="w-full h-full object-cover opacity-40 group-hover:opacity-100 transition-all duration-500" 
                            referrerPolicy="no-referrer" 
                          />
                          <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                            <p className="text-[9px] font-mono truncate text-zinc-300 mb-0.5 tracking-tight">{item.name}</p>
                            <div className="flex items-center justify-between">
                              <p className="text-[8px] font-mono text-zinc-500 uppercase tracking-widest">ID: {item.id}</p>
                              <p className="text-[8px] font-mono text-blue-400 font-bold">{(item.descriptors?.length || 0)} Faces</p>
                            </div>
                          </div>
                          
                          {isManagementMode && (
                            <button 
                              onClick={() => deleteGalleryItem(item.id)}
                              className="absolute top-2 right-2 p-1.5 rounded-lg bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-all shadow-xl hover:bg-red-600"
                            >
                              <AlertCircle className="w-3 h-3" />
                            </button>
                          )}
                        </motion.div>
                      );
                    })}
                  
                  {!isManagementMode && gallery.length > 20 && (
                    <button 
                      onClick={() => setIsManagementMode(true)}
                      className="aspect-square rounded-2xl border border-dashed border-zinc-800 flex flex-col items-center justify-center glass hover:bg-zinc-800/30 transition-all group"
                    >
                      <p className="text-[11px] font-bold text-zinc-500 group-hover:text-zinc-300 tracking-wider">+{gallery.length - 20}</p>
                      <p className="text-[9px] text-zinc-600 uppercase tracking-[0.2em] mt-1">View All</p>
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 rounded-[2rem] glass flex flex-col items-center justify-center text-center">
              <p className="text-sm text-zinc-500 tracking-wide">No images indexed yet.</p>
              <p className="text-[10px] text-zinc-600 mt-2 uppercase tracking-[0.15em]">Import a folder to begin</p>
            </div>
          )}
        </section>

          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-zinc-800/50 mt-12 flex flex-col md:flex-row justify-between items-center gap-6">
        <p className="text-xs text-zinc-600 font-mono uppercase tracking-widest">
          &copy; 2026 FaceMatch Neural Systems. All rights reserved.
        </p>
        <div className="flex items-center gap-8">
          <a href="#" className="text-xs text-zinc-500 hover:text-blue-400 transition-colors uppercase tracking-widest font-bold">Documentation</a>
          <a href="#" className="text-xs text-zinc-500 hover:text-blue-400 transition-colors uppercase tracking-widest font-bold">API Access</a>
          <a href="#" className="text-xs text-zinc-500 hover:text-blue-400 transition-colors uppercase tracking-widest font-bold">Privacy</a>
        </div>
      </footer>
    </div>
  );
}
