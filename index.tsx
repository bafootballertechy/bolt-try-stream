import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, Pause, RotateCcw, RotateCw, Trash2, Upload,
  Maximize, Minimize, MousePointer2, Circle, Pen,
  MoveUpRight, Hexagon, GitCommitVertical, Settings2,
  ChevronRight, ChevronLeft, Type, Video, Undo2, Redo2,
  Download, X, AlertTriangle, LogOut, Minus, Layers, Eye, EyeOff,
  SlidersHorizontal, CornerUpRight, Volume2, VolumeX, Flag, User, Flashlight, ZoomIn, Cylinder,
  Activity, Spline, Slash, MoreHorizontal, PaintBucket,
  Tags, FolderPlus, Folder, Film, ListPlus, Filter, Keyboard, Plus, Save, Edit2, Check,
  GripVertical, PlayCircle, StopCircle, Pencil, Trash, PlusCircle, FileUp, FileDown, MessageSquare,
  Presentation, Globe
} from 'lucide-react';

// --- Types ---

type ToolType = 'pen' | 'line' | 'arrow' | 'curved-arrow' | 'circle' | 'polygon' | 'connected-circle' | 'masking' | 'player-move' | 'spotlight' | 'lens' | null;

interface Point {
  x: number;
  y: number;
  r?: number; // Radius for connected circles (Video Space)
  timestamp?: number; // Time of creation for animation
}

interface Rect {
    x: number;
    y: number;
    w: number;
    h: number;
}

interface Particle {
  initialAngle: number;
  speed: number;
}

interface Shape {
  id: string;
  type: ToolType;
  points: Point[]; // Stored in Video Space
  color: string;
  strokeWidth: number; // Stored in Screen Pixels (will be scaled)
  isClosed?: boolean; 
  isFilled?: boolean; 
  isDashed?: boolean; 
  isFreehand?: boolean; 
  img?: ImageBitmap; 
  bgImg?: ImageBitmap; 
  box?: Rect; // Stored in Video Space
  timestamp: number; 
  spotlightConfig?: {
    size: number; // Video Space or Screen Space? Let's use Screen Space and scale
    intensity: number;
    rotation: number;
    particles: Particle[];
  };
  lensConfig?: {
      radius: number; // Screen Space (slider value)
      zoom: number;
  };
  ringConfig?: {
      tilt: number; 
      isFilled?: boolean;
  };
}

interface ColorPreset {
  id: number;
  value: string;
}

interface MaskSettings {
  enabled: boolean;
  sensitivity: number; // 0-100
  showOverlay: boolean;
}

interface MaskLayerCache {
  foreground: ImageBitmap | null; 
  overlay: ImageBitmap | null;    
  timestamp: number;              
}

interface TimelineMarker {
  id: string;
  time: number;
  label: string;
  color: string;
}

// --- Tagging & Playlist Types ---

interface Tag {
  id: string;
  name: string;
  color: string;
  shortcut: string;
}

interface TagEvent {
  id: string;
  tagId: string;
  startTime: number;
  endTime: number;
  notes?: string;
}

interface Playlist {
  id: string;
  name: string;
  events: TagEvent[]; 
}

// --- Constants ---

const INITIAL_COLORS: ColorPreset[] = [
  { id: 1, value: '#ef4444' }, // Red
  { id: 2, value: '#ffff00' }, // Pure Yellow
  { id: 3, value: '#3b82f6' }, // Blue
  { id: 4, value: '#22c55e' }, // Green
  { id: 5, value: '#ffffff' }, // White
  { id: 6, value: '#00eaff' }, // Cyan
  { id: 7, value: '#f97316' }, // Orange
  { id: 8, value: '#d946ef' }, // Magenta/Fuchsia
  { id: 9, value: '#000000' }, // Black
];

const DEFAULT_TAGS: Tag[] = [
  { id: '1', name: 'Goal', color: '#22c55e', shortcut: '1' },
  { id: '2', name: 'Foul', color: '#ef4444', shortcut: '2' },
  { id: '3', name: 'Shot', color: '#3b82f6', shortcut: '3' },
  { id: '4', name: 'Corner', color: '#f59e0b', shortcut: '4' },
  { id: '5', name: 'Pass', color: '#ffffff', shortcut: '5' },
];

// --- Helper Functions ---

const getDistance = (p1: Point, p2: Point) => Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));

const getVideoLayout = (canvas: HTMLCanvasElement, video: HTMLVideoElement) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = canvas.width;
    const ch = canvas.height;
    if (!vw || !vh) return { x: 0, y: 0, w: cw, h: ch, scale: 1 };

    const videoRatio = vw / vh;
    const canvasRatio = cw / ch;
    
    let drawW, drawH, drawX, drawY, scale;

    if (canvasRatio > videoRatio) {
        drawH = ch;
        drawW = ch * videoRatio;
        drawX = (cw - drawW) / 2;
        drawY = 0;
        scale = drawH / vh;
    } else {
        drawW = cw;
        drawH = cw / videoRatio;
        drawY = (ch - drawH) / 2;
        drawX = 0;
        scale = drawW / vw;
    }
    return { x: drawX, y: drawY, w: drawW, h: drawH, scale };
};

const createParticles = (count: number = 30): Particle[] => {
  const arr: Particle[] = [];
  for (let i = 0; i < count; i++) {
    arr.push({
      initialAngle: Math.random() * Math.PI * 2,
      speed: 0.002 + Math.random() * 0.003 // Radians per ms
    });
  }
  return arr;
};

const drawArrowHead = (ctx: CanvasRenderingContext2D, from: Point, to: Point, size: number) => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - size * Math.cos(angle - Math.PI / 6), to.y - size * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(to.x - size * Math.cos(angle + Math.PI / 6), to.y - size * Math.sin(angle + Math.PI / 6));
  ctx.lineTo(to.x, to.y);
  ctx.fill();
};

const fadeColor = (hex: string, opacity: number) => {
    // Simple hex to rgba
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
};

const adjustBrightness = (hex: string, percent: number) => {
    const r = Math.min(255, Math.max(0, parseInt(hex.slice(1, 3), 16) + percent));
    const g = Math.min(255, Math.max(0, parseInt(hex.slice(3, 5), 16) + percent));
    const b = Math.min(255, Math.max(0, parseInt(hex.slice(5, 7), 16) + percent));
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const shiftColor = (hex: string, amt: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  const f = (c: number) => clamp(Math.round(c + (amt / 100) * 255), 0, 255);
  
  const rr = f(r).toString(16).padStart(2, '0');
  const gg = f(g).toString(16).padStart(2, '0');
  const bb = f(b).toString(16).padStart(2, '0');
  
  return `#${rr}${gg}${bb}`;
};

const rgbToHsl = (r: number, g: number, b: number) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
};

const drawDashedLine = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, color: string, width: number = 2) => {
  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([width * 2, width * 2]);
  ctx.moveTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.stroke();
  ctx.restore();
};

const drawLabel = (ctx: CanvasRenderingContext2D, p: Point, text: string, scale: number) => {
  ctx.save();
  // Scale font size inversely so it remains constant screen size
  const fontSize = 11 / scale;
  ctx.font = `500 ${fontSize}px Inter, sans-serif`;
  const metrics = ctx.measureText(text);
  const paddingX = 8 / scale;
  const h = 22 / scale;
  const w = metrics.width + paddingX * 2;
  const x = p.x + (15 / scale);
  const y = p.y + (15 / scale);
  const radius = 4 / scale;
  
  // Background
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 4 / scale;
  ctx.fillStyle = 'rgba(20, 20, 20, 0.85)';
  ctx.beginPath();
  if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, radius);
  } else {
      ctx.rect(x, y, w, h);
  }
  ctx.fill();
  
  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1 / scale;
  ctx.stroke();
  
  // Text
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.shadowBlur = 0;
  ctx.fillText(text, x + paddingX, y + h/2 + (1/scale));
  ctx.restore();
};

// --- Advanced Rendering (3D Rings & Arrows) ---

const getShimmerGradient = (
    ctx: CanvasRenderingContext2D, 
    p1: Point, 
    p2: Point, 
    color: string, 
    isPreview: boolean
) => {
    const grad = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
    const shimmerSpeed = 0.001; 
    const shimmerOffset = (Date.now() * shimmerSpeed) % 2; 

    if (isPreview) {
        grad.addColorStop(0, fadeColor(color, 0.2));
        grad.addColorStop(0.5, color);
        grad.addColorStop(1, fadeColor(color, 0.2));
    } else {
        const stop1 = Math.max(0, Math.min(1, shimmerOffset - 0.2));
        const stop2 = Math.max(0, Math.min(1, shimmerOffset));
        const stop3 = Math.max(0, Math.min(1, shimmerOffset + 0.2));
        
        grad.addColorStop(0, fadeColor(color, 0.6));
        
        if (stop2 > 0 && stop2 < 1) {
             grad.addColorStop(stop1, color);
             grad.addColorStop(stop2, '#ffffff'); 
             grad.addColorStop(stop3, color);
        } else {
             grad.addColorStop(0.5, color);
        }

        grad.addColorStop(1, fadeColor(color, 0.6));
    }
    return grad;
};

const drawFreehandArrow = (
    ctx: CanvasRenderingContext2D,
    points: Point[],
    color: string,
    thickness: number,
    isDashed: boolean,
    timestamp: number,
    isPreview: boolean
) => {
    if (points.length < 2) return;
    
    // Draw the freehand path
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = thickness;
    
    // Gradient Approximation (Start to End)
    const pStart = points[0];
    const pEnd = points[points.length - 1];
    ctx.strokeStyle = getShimmerGradient(ctx, pStart, pEnd, color, isPreview);

    if (isDashed) {
        ctx.setLineDash([thickness * 2, thickness * 1.5]);
    }

    if (!isPreview) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    
    // Smooth spline
    for (let i = 1; i < points.length - 2; i++) {
        const xc = (points[i].x + points[i + 1].x) / 2;
        const yc = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc);
    }
    // Last segments
    if (points.length > 2) {
        ctx.quadraticCurveTo(
            points[points.length - 2].x, 
            points[points.length - 2].y, 
            points[points.length - 1].x, 
            points[points.length - 1].y
        );
    } else {
        ctx.lineTo(points[1].x, points[1].y);
    }
    ctx.stroke();

    // Arrow Head
    const len = points.length;
    const endP = points[len - 1];
    const prevP = points[len - 2] || points[len - 3] || points[0]; 
    
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    drawArrowHead(ctx, prevP, endP, thickness * 3);

    ctx.restore();
};

const drawProArrow = (
  ctx: CanvasRenderingContext2D,
  p1: Point,
  p2: Point,
  color: string,
  thickness: number,
  isDashed: boolean,
  timestamp: number,
  isPreview: boolean = false
) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const angle = Math.atan2(dy, dx);
    const length = Math.sqrt(dx*dx + dy*dy);

    const duration = 500; 
    const age = isPreview ? duration : (Date.now() - timestamp);
    const progress = Math.min(1, age / duration);

    if (length < 1) return;

    const currentLength = length * progress;
    const currentEndX = p1.x + Math.cos(angle) * currentLength;
    const currentEndY = p1.y + Math.sin(angle) * currentLength;

    const headSize = Math.max(thickness * 2.5, 10); // Constant size relative to line
    const headLength = headSize * 0.85;
    const shortenDist = headLength * Math.cos(Math.PI / 6) * 0.9;
    
    let lineEndX = currentEndX;
    let lineEndY = currentEndY;
    const hasHead = currentLength > shortenDist || isPreview;

    if (hasHead) {
        lineEndX = currentEndX - Math.cos(angle) * shortenDist;
        lineEndY = currentEndY - Math.sin(angle) * shortenDist;
    }

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    ctx.strokeStyle = getShimmerGradient(ctx, p1, {x: currentEndX, y: currentEndY}, color, isPreview);
    ctx.lineWidth = thickness;
    
    if (isDashed) {
        ctx.setLineDash([thickness * 2, thickness * 1.5]);
    }
    
    if (!isPreview) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 12; 
    }
    
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    if (currentLength > 0) {
        ctx.lineTo(lineEndX, lineEndY);
        ctx.stroke();
    }
    
    ctx.shadowBlur = 0;
    ctx.setLineDash([]);

    if (hasHead) {
        const tipX = currentEndX;
        const tipY = currentEndY;
        
        const barb1x = tipX - headLength * Math.cos(angle - Math.PI / 6);
        const barb1y = tipY - headLength * Math.sin(angle - Math.PI / 6);
        const barb2x = tipX - headLength * Math.cos(angle + Math.PI / 6);
        const barb2y = tipY - headLength * Math.sin(angle + Math.PI / 6);

        ctx.beginPath();
        ctx.moveTo(barb1x, barb1y);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(barb2x, barb2y);
        ctx.closePath();
        
        ctx.fillStyle = color;
        ctx.fill();
        
        ctx.strokeStyle = adjustBrightness(color, -40); 
        ctx.lineWidth = Math.max(1, thickness * 0.2);
        ctx.stroke();
    }

    ctx.restore();
};

const draw3DRing = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  tiltDegrees: number,
  strokeWidth: number,
  timestamp: number,
  isGhost: boolean = false
) => {
  if (radius < 1) return;
  
  const now = Date.now();
  const timeElapsed = isGhost ? now : (now - timestamp);
  
  let scaleEnt = 1;
  let alphaEnt = 1;
  if (!isGhost && timeElapsed < 500) {
      const p = timeElapsed / 500;
      if (p < 0.6) {
          scaleEnt = 0.3 + (1.08 - 0.3) * (p / 0.6); 
      } else {
          scaleEnt = 1.08 - (0.08) * ((p - 0.6) / 0.4); 
      }
      alphaEnt = Math.min(1, p * 2);
  }

  const tiltRad = (tiltDegrees * Math.PI) / 180;
  const scaleY = Math.max(0.01, Math.cos(tiltRad)); 

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scaleEnt, scaleEnt * scaleY); 
  
  ctx.globalAlpha = alphaEnt * (isGhost ? 0.7 : 1.0);

  const duration = 2500; 
  const spinAngle = (timeElapsed % duration) / duration * Math.PI * 2;

  const innerRadius = radius * 0.65; 

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.arc(0, 0, innerRadius, Math.PI * 2, 0, true); 
  ctx.closePath();
  ctx.clip();

  try {
      const grad = ctx.createConicGradient(spinAngle, 0, 0);
      grad.addColorStop(0, color);
      grad.addColorStop(0.4, shiftColor(color, -30)); 
      grad.addColorStop(0.7, shiftColor(color, -10)); 
      grad.addColorStop(1, color);

      ctx.fillStyle = grad;
      ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  } catch(e) {
      ctx.fillStyle = color;
      ctx.fill();
  }
  
  ctx.lineWidth = strokeWidth;

  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)'; 
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, innerRadius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; 
  ctx.stroke();

  if (!isGhost) {
      ctx.shadowBlur = 15;
      ctx.shadowColor = fadeColor(color, 0.4);
  }

  ctx.restore();
};

const drawSpotlight = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  intensity: number,
  rotation: number,
  particles: Particle[],
  timestamp: number,
  isGhost: boolean = false
) => {
    const now = Date.now();
    const alpha = isGhost ? 0.4 : 1.0;
    const beamWidth = size;
    const topY = 0;
    const bottomY = y;

    ctx.save();
    const grad = ctx.createLinearGradient(x, topY, x, bottomY);
    grad.addColorStop(0, `rgba(255,255,255,0)`);
    grad.addColorStop(0.5, `rgba(255,255,255,${intensity * 0.25 * alpha})`);
    grad.addColorStop(1, `rgba(255,255,255,${0.05 * alpha})`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x - beamWidth / 4, topY);
    ctx.lineTo(x + beamWidth / 4, topY);
    ctx.lineTo(x + beamWidth / 2, bottomY);
    ctx.lineTo(x - beamWidth / 2, bottomY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, bottomY);
    ctx.scale(1, rotation); 
    
    const ringRadius = beamWidth / 2;

    const ringGrad = ctx.createRadialGradient(0, 0, ringRadius * 0.3, 0, 0, ringRadius * 1.3);
    ringGrad.addColorStop(0, `rgba(255,255,255,${0.9 * alpha})`);
    ringGrad.addColorStop(0.6, `rgba(255,255,255,${0.3 * alpha})`);
    ringGrad.addColorStop(1, `rgba(255,255,255,0)`);

    ctx.fillStyle = ringGrad;
    ctx.beginPath();
    ctx.arc(0, 0, ringRadius * 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(255,255,255,${0.2 * intensity * alpha})`; 
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    if (!isGhost) {
        const timeDelta = now - timestamp;
        
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            const currentAngle = p.initialAngle + (timeDelta * p.speed);
            
            const px = Math.cos(currentAngle) * ringRadius;
            const py = Math.sin(currentAngle) * ringRadius; 

            const flicker = 0.5 + 0.5 * Math.sin(timeDelta * 0.005 + i);

            ctx.fillStyle = `rgba(255,255,255,${0.6 * flicker})`;
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.restore();
};

const drawTangentLine = (
  ctx: CanvasRenderingContext2D,
  p1: Point,
  p2: Point,
  r1: number,
  r2: number,
  color: string,
  strokeWidth: number,
  progress: number, 
  pulseAge: number = 0 
) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < 1e-6) return;

    const ux = dx / dist;
    const uy = dy / dist;

    const startX = p1.x + ux * (r1 * 0.8); 
    const startY = p1.y + uy * (r1 * 0.8);
    const endX = p2.x - ux * (r2 * 0.8);
    const endY = p2.y - uy * (r2 * 0.8);

    const lineLen = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));

    ctx.save();
    ctx.beginPath();
    
    const grad = ctx.createLinearGradient(startX, startY, endX, endY);
    
    const cBase = color;
    const cDark = shiftColor(color, -30);
    
    grad.addColorStop(0, cBase);
    grad.addColorStop(0.3, cDark);
    grad.addColorStop(0.7, cBase);
    grad.addColorStop(1, cDark);
    
    ctx.strokeStyle = grad;
    ctx.lineWidth = strokeWidth * 1.5; 
    ctx.lineCap = 'round';
    
    if (pulseAge > 0) {
        const pulse = Math.sin((pulseAge / 500)); 
        ctx.shadowBlur = 2 + 2 * pulse; 
        ctx.shadowColor = color;
        ctx.globalAlpha = 0.4 + 0.2 * pulse; 
    } else {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.9;
    }

    ctx.setLineDash([lineLen]);
    ctx.lineDashOffset = lineLen * (1 - progress);

    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    ctx.restore();
};

const drawCurvedArrow = (
  ctx: CanvasRenderingContext2D,
  p1: Point,
  p2: Point,
  color: string,
  width: number,
  isDashed: boolean,
  timestamp: number,
  renderMode: 'full' | 'shadow' | 'body' = 'full'
) => {
    const now = Date.now();
    const duration = 600;
    const progress = timestamp > 0 ? Math.min(1, (now - timestamp) / duration) : 1;

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx*dx + dy*dy);

    if (dist < 2) return;

    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    
    const arcHeight = dist * 0.3; 
    const cpx = mx; 
    const cpy = my - arcHeight; 

    if (renderMode === 'full' || renderMode === 'shadow') {
        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0,0,0,0.3)';
        ctx.lineWidth = width;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.lineCap = 'round';
        
        const arcLen = dist * 1.2;
        
        if (isDashed) {
             ctx.setLineDash([width * 2, width * 1.5]);
        } else {
             ctx.setLineDash([arcLen]);
             ctx.lineDashOffset = arcLen * (1 - progress);
        }

        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        
        if (progress > 0.9) {
            ctx.setLineDash([]);
            ctx.fillStyle = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 5;
            drawArrowHead(ctx, p1, p2, width * 3);
        }
        ctx.restore();
    }

    if (renderMode === 'full' || renderMode === 'body') {
        ctx.save();
        
        ctx.strokeStyle = getShimmerGradient(ctx, p1, p2, color, timestamp === 0);
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        
        if (isDashed) {
             ctx.setLineDash([width * 2, width * 1.5]);
        } else {
             const arcLen = dist * 1.2; 
             ctx.setLineDash([arcLen]);
             ctx.lineDashOffset = arcLen * (1 - progress);
        }

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.quadraticCurveTo(cpx, cpy, p2.x, p2.y);
        ctx.stroke();

        if (progress > 0.8) {
            ctx.setLineDash([]);
            const angle = Math.atan2(p2.y - cpy, p2.x - cpx);
            const headSize = width * 4;
            const tipX = p2.x;
            const tipY = p2.y;
            
            const barb1x = tipX - headSize * Math.cos(angle - Math.PI / 6);
            const barb1y = tipY - headSize * Math.sin(angle - Math.PI / 6);
            const barb2x = tipX - headSize * Math.cos(angle + Math.PI / 6);
            const barb2y = tipY - headSize * Math.sin(angle + Math.PI / 6);

            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.moveTo(barb1x, barb1y);
            ctx.lineTo(tipX, tipY);
            ctx.lineTo(barb2x, barb2y);
            ctx.closePath();
            ctx.fill();
            
            ctx.strokeStyle = 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        
        ctx.restore();
    }
};

const drawLens = (
  ctx: CanvasRenderingContext2D,
  center: Point, // Video Space
  radius: number, // Screen Space
  zoom: number,
  video: HTMLVideoElement,
  scale: number,
  isGhost: boolean = false
) => {
    // Lens logic needs source rectangle from Video Space
    // Radius in Video Space = radius / scale
    const radiusVideo = radius / scale;
    const sourceW = (radiusVideo * 2) / zoom;
    const sourceH = sourceW; // circle
    
    const sourceX = center.x - sourceW / 2;
    const sourceY = center.y - sourceH / 2;

    ctx.save();
    if (isGhost) ctx.globalAlpha = 0.8;

    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 20 / scale;
    ctx.shadowOffsetY = 10 / scale;
    
    // Clip Circle in Video Space
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusVideo, 0, Math.PI * 2);
    ctx.clip();
    
    // Draw Zoomed Video
    // ctx is transformed to Video Space. drawImage(video, ...) draws at video coords.
    // We want to draw the source chunk at the destination location (center - radiusVideo)
    // Destination Size in Video Space = radiusVideo * 2
    try {
        ctx.drawImage(video, sourceX, sourceY, sourceW, sourceH, center.x - radiusVideo, center.y - radiusVideo, radiusVideo * 2, radiusVideo * 2);
    } catch(e) {
        ctx.fillStyle = '#000';
        ctx.fill();
    }
    
    // Glass Effect
    const grad = ctx.createRadialGradient(center.x - radiusVideo*0.3, center.y - radiusVideo*0.3, radiusVideo*0.2, center.x, center.y, radiusVideo);
    grad.addColorStop(0, 'rgba(255,255,255,0.15)');
    grad.addColorStop(1, 'rgba(255,255,255,0.02)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Borders
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusVideo, 0, Math.PI * 2);

    ctx.shadowColor = 'transparent'; 
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4 / scale;
    ctx.stroke();
    
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1 / scale;
    ctx.stroke();
    
    ctx.restore();
    
    if (isGhost) {
        drawLabel(ctx, { x: center.x, y: center.y + radiusVideo }, `${zoom}x`, scale);
    }
};

// --- Components ---

const App = () => {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const handleUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setVideoFile(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
    }
  };

  return (
    <div className="w-screen h-screen bg-[#0a0a0a] text-white flex flex-col overflow-hidden">
      {!videoUrl ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md w-full bg-[#161616] border border-[#333] rounded-2xl p-10 flex flex-col items-center text-center shadow-2xl"
          >
            <div className="w-20 h-20 bg-blue-600/20 rounded-full flex items-center justify-center mb-6">
              <Video className="w-10 h-10 text-blue-500" />
            </div>
            <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              Zone 14
            </h1>
            <p className="text-gray-400 mb-8">Professional Video Analysis Suite</p>
            
            <label className="group cursor-pointer relative overflow-hidden rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 px-8 py-4 font-semibold text-white transition-all hover:scale-105 active:scale-95">
              <span className="relative z-10 flex items-center gap-2">
                <Upload className="w-5 h-5" />
                Select Video File
              </span>
              <input 
                type="file" 
                accept="video/*" 
                className="hidden" 
                onChange={handleUpload}
              />
              <div className="absolute inset-0 bg-white/20 translate-y-full transition-transform group-hover:translate-y-0" />
            </label>
            <p className="mt-4 text-xs text-gray-600">Local session only. No server uploads.</p>
          </motion.div>
        </div>
      ) : (
        <Workspace videoUrl={videoUrl} fileName={videoFile?.name} onClose={() => setVideoUrl(null)} />
      )}
    </div>
  );
};

const Workspace = ({ videoUrl, fileName, onClose }: { videoUrl: string, fileName?: string, onClose: () => void }) => {
  // State
  const [viewMode, setViewMode] = useState<'video' | 'slides'>('video');
  const [slideUrl, setSlideUrl] = useState<string>('https://www.google.com'); // Placeholder, since embedding arbitrary sites is often blocked
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.4);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(true);
  
  // Drawing State
  const [tool, setTool] = useState<ToolType>(null);
  const [colors, setColors] = useState<ColorPreset[]>(INITIAL_COLORS);
  const [activeColorId, setActiveColorId] = useState<number>(6); 
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [redoStack, setRedoStack] = useState<Shape[][]>([]);
  
  // Interaction State
  const [isDrawing, setIsDrawing] = useState(false);
  const [activePoints, setActivePoints] = useState<Point[]>([]); 
  const [currentDragStart, setCurrentDragStart] = useState<Point | null>(null); 
  const mousePosRef = useRef<Point | null>(null); // For tracking ghost cursor in video space

  // Arrow Settings
  const [arrowSettings, setArrowSettings] = useState({
      isDashed: false,
      isFreehand: false
  });

  // Player Dragger State
  const [playerMoveState, setPlayerMoveState] = useState<'idle' | 'selecting' | 'moving'>('idle');
  const [playerSelectionRect, setPlayerSelectionRect] = useState<Rect | null>(null); // Video Space
  const [capturedSprite, setCapturedSprite] = useState<{ sprite: ImageBitmap, patch: ImageBitmap, box: Rect } | null>(null);
  
  // Spotlight State
  const [spotlightSettings, setSpotlightSettings] = useState({
    size: 45, 
    intensity: 0.75, 
    rotation: 0.45 
  });

  // Lens State
  const [lensSettings, setLensSettings] = useState({
      size: 75, 
      zoom: 2.0
  });

  // Ring State
  const [ringSettings, setRingSettings] = useState({
      tilt: 65, 
      isFilled: false
  });

  // Masking State
  const [maskSettings, setMaskSettings] = useState<MaskSettings>({
    enabled: false,
    sensitivity: 40,
    showOverlay: true,
  });
  const [maskCache, setMaskCache] = useState<MaskLayerCache>({ foreground: null, overlay: null, timestamp: -1 });
  const [isProcessingMask, setIsProcessingMask] = useState(false);

  // Markers State
  const [markers, setMarkers] = useState<TimelineMarker[]>([]);
  const [markerModal, setMarkerModal] = useState<{
    isOpen: boolean;
    x: number;
    y: number;
    mode: 'create' | 'edit';
    markerId?: string; 
    time?: number; 
    tempLabel: string;
    tempColor: string;
  } | null>(null);

  // --- Tagging & Playlist State ---
  const [tags, setTags] = useState<Tag[]>(DEFAULT_TAGS);
  const [tagEvents, setTagEvents] = useState<TagEvent[]>([]);
  const [isTaggingMode, setIsTaggingMode] = useState(false);
  const [activeRecording, setActiveRecording] = useState<{ tagId: string, startTime: number } | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([
    { id: 'p1', name: 'Highlights', events: [] },
    { id: 'p2', name: 'Defense', events: [] }
  ]);
  const [activePlaylistId, setActivePlaylistId] = useState<string>('p1');
  const [filterTagId, setFilterTagId] = useState<string | null>(null);
  const [tagSettingsOpen, setTagSettingsOpen] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [tempTag, setTempTag] = useState<Partial<Tag>>({});

  // Playlist Management State
  const [playlistModal, setPlaylistModal] = useState<{ isOpen: boolean; mode: 'create' | 'edit'; playlistId?: string; tempName: string } | null>(null);
  const [playlistDeleteId, setPlaylistDeleteId] = useState<string | null>(null);
  const [autoplay, setAutoplay] = useState<{ active: boolean; playlistId: string | null; eventIndex: number }>({ active: false, playlistId: null, eventIndex: -1 });
  const [draggingEventIndex, setDraggingEventIndex] = useState<number | null>(null);

  // Timeline Editing State
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, eventId: string } | null>(null);
  const [editEventModal, setEditEventModal] = useState<{ isOpen: boolean, eventId: string, startTime: number, endTime: number, notes: string } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);

  // --- UI Resizing State ---
  const [rightPanelWidth, setRightPanelWidth] = useState(300);
  const [tagsSectionHeight, setTagsSectionHeight] = useState(220); 
  const isResizingWidth = useRef(false);
  const isResizingHeight = useRef(false);
  const startResizePos = useRef<{ x: number, y: number, w: number, h: number }>({ x: 0, y: 0, w: 0, h: 0 });


  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);

  // Computed
  const currentColor = colors.find(c => c.id === activeColorId)?.value || '#00eaff';

  // --- Resizing Logic ---
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
        if (isResizingWidth.current) {
            const deltaX = startResizePos.current.x - e.clientX; 
            const newWidth = Math.max(250, Math.min(startResizePos.current.w + deltaX, 800));
            setRightPanelWidth(newWidth);
        }
        if (isResizingHeight.current) {
            const deltaY = e.clientY - startResizePos.current.y;
            const containerHeight = window.innerHeight - 56; // Top bar
            const minPlaylistHeight = 150; 
            const maxH = containerHeight - minPlaylistHeight;
            const newHeight = Math.max(0, Math.min(startResizePos.current.h + deltaY, maxH));
            setTagsSectionHeight(newHeight);
        }
    };

    const handleMouseUp = () => {
        isResizingWidth.current = false;
        isResizingHeight.current = false;
        document.body.style.cursor = 'default';
        document.body.style.userSelect = 'auto';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const startResizeWidth = (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingWidth.current = true;
      startResizePos.current = { x: e.clientX, y: e.clientY, w: rightPanelWidth, h: tagsSectionHeight };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
  };

  const startResizeHeight = (e: React.MouseEvent) => {
      e.preventDefault();
      isResizingHeight.current = true;
      startResizePos.current = { x: e.clientX, y: e.clientY, w: rightPanelWidth, h: tagsSectionHeight };
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
  };

  // --- Video Logic ---

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
      videoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  useEffect(() => {
    if (isPlaying) {
      setShapes([]);
      setRedoStack([]);
      setActivePoints([]);
      setIsDrawing(false);
      setCurrentDragStart(null);
      setPlayerMoveState('idle');
      setPlayerSelectionRect(null);
      setCapturedSprite(null);
    }
  }, [isPlaying]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        if (autoplay.active) {
            setAutoplay({ active: false, playlistId: null, eventIndex: -1 });
        }
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const time = videoRef.current.currentTime;
      setCurrentTime(time);

      if (autoplay.active && autoplay.playlistId) {
          const playlist = playlists.find(p => p.id === autoplay.playlistId);
          if (playlist && playlist.events.length > autoplay.eventIndex) {
              const currentEvent = playlist.events[autoplay.eventIndex];
              if (time >= currentEvent.endTime) {
                  const nextIndex = autoplay.eventIndex + 1;
                  if (nextIndex < playlist.events.length) {
                      const nextEvent = playlist.events[nextIndex];
                      setAutoplay(prev => ({ ...prev, eventIndex: nextIndex }));
                      if (videoRef.current) {
                          videoRef.current.currentTime = nextEvent.startTime;
                          if (videoRef.current.paused) videoRef.current.play();
                      }
                  } else {
                      setAutoplay({ active: false, playlistId: null, eventIndex: -1 });
                      setIsPlaying(false);
                      videoRef.current.pause();
                  }
              }
          }
      }
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      videoRef.current.playbackRate = playbackRate;
      videoRef.current.muted = isMuted;
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
      setMaskCache({ foreground: null, overlay: null, timestamp: -1 });
    }
  };

  // --- Playlist Logic ---

  const savePlaylist = () => {
      if (!playlistModal) return;
      if (playlistModal.mode === 'create') {
          const newId = Date.now().toString();
          setPlaylists(prev => [...prev, { id: newId, name: playlistModal.tempName || 'New Playlist', events: [] }]);
          setActivePlaylistId(newId);
      } else if (playlistModal.mode === 'edit' && playlistModal.playlistId) {
          setPlaylists(prev => prev.map(p => p.id === playlistModal.playlistId ? { ...p, name: playlistModal.tempName } : p));
      }
      setPlaylistModal(null);
  };

  const confirmDeletePlaylist = () => {
      if (playlistDeleteId) {
          setPlaylists(prev => prev.filter(p => p.id !== playlistDeleteId));
          if (activePlaylistId === playlistDeleteId) {
              setActivePlaylistId(playlists.find(p => p.id !== playlistDeleteId)?.id || '');
          }
          setPlaylistDeleteId(null);
      }
  };

  const removeEventFromPlaylist = (playlistId: string, eventIndex: number) => {
      setPlaylists(prev => prev.map(p => {
          if (p.id === playlistId) {
              const newEvents = [...p.events];
              newEvents.splice(eventIndex, 1);
              return { ...p, events: newEvents };
          }
          return p;
      }));
  };

  const reorderPlaylistEvents = (playlistId: string, fromIndex: number, toIndex: number) => {
      setPlaylists(prev => prev.map(p => {
          if (p.id === playlistId) {
              const newEvents = [...p.events];
              const [moved] = newEvents.splice(fromIndex, 1);
              newEvents.splice(toIndex, 0, moved);
              return { ...p, events: newEvents };
          }
          return p;
      }));
  };

  const startPlaylistAutoplay = (playlistId: string) => {
      const playlist = playlists.find(p => p.id === playlistId);
      if (playlist && playlist.events.length > 0) {
          const startEvent = playlist.events[0];
          setAutoplay({ active: true, playlistId, eventIndex: 0 });
          if (videoRef.current) {
              videoRef.current.currentTime = startEvent.startTime;
              videoRef.current.play();
              setIsPlaying(true);
          }
      }
  };

  const exportXML = () => {
    let xml = '<zone14_data>\n';
    
    xml += '  <tags>\n';
    tags.forEach(t => {
        xml += `    <tag id="${t.id}" name="${t.name}" color="${t.color}" shortcut="${t.shortcut}" />\n`;
    });
    xml += '  </tags>\n';

    xml += '  <events>\n';
    tagEvents.forEach(e => {
        xml += `    <event id="${e.id}" tagId="${e.tagId}" startTime="${e.startTime}" endTime="${e.endTime}">\n`;
        if (e.notes) xml += `      <notes>${e.notes}</notes>\n`;
        xml += `    </event>\n`;
    });
    xml += '  </events>\n';

    xml += '  <playlists>\n';
    playlists.forEach(p => {
        xml += `    <playlist id="${p.id}" name="${p.name}">\n`;
        p.events.forEach(pe => {
            xml += `      <clip eventId="${pe.id}" />\n`;
        });
        xml += `    </playlist>\n`;
    });
    xml += '  </playlists>\n';
    xml += '</zone14_data>';
    
    const blob = new Blob([xml], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    const currentPlaylistName = playlists.find(p => p.id === activePlaylistId)?.name;
    const baseName = currentPlaylistName ? currentPlaylistName.replace(/[^a-z0-9]/gi, '_') : 'Analysis';
    a.download = `${baseName}.xml`;
    
    a.click();
    URL.revokeObjectURL(url);
  };

  const importXML = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
          const text = e.target?.result as string;
          if (!text) return;
          
          try {
              const parser = new DOMParser();
              const doc = parser.parseFromString(text, "text/xml");
              
              const newTags: Tag[] = [];
              const tagNodes = doc.getElementsByTagName('tag');
              for (let i = 0; i < tagNodes.length; i++) {
                  const node = tagNodes[i];
                  newTags.push({
                      id: node.getAttribute('id') || Date.now().toString(),
                      name: node.getAttribute('name') || 'Imported',
                      color: node.getAttribute('color') || '#fff',
                      shortcut: node.getAttribute('shortcut') || ''
                  });
              }
              if (newTags.length > 0) setTags(newTags);

              const newEvents: TagEvent[] = [];
              const eventNodes = doc.getElementsByTagName('event');
              for (let i = 0; i < eventNodes.length; i++) {
                  const node = eventNodes[i];
                  const notesNode = node.getElementsByTagName('notes')[0];
                  newEvents.push({
                      id: node.getAttribute('id') || Date.now().toString(),
                      tagId: node.getAttribute('tagId') || '',
                      startTime: parseFloat(node.getAttribute('startTime') || '0'),
                      endTime: parseFloat(node.getAttribute('endTime') || '0'),
                      notes: notesNode ? notesNode.textContent || '' : undefined
                  });
              }
              if (newEvents.length > 0) setTagEvents(newEvents);

              const newPlaylists: Playlist[] = [];
              const plNodes = doc.getElementsByTagName('playlist');
              for (let i = 0; i < plNodes.length; i++) {
                  const node = plNodes[i];
                  const plEvents: TagEvent[] = [];
                  const clipNodes = node.getElementsByTagName('clip');
                  for (let j = 0; j < clipNodes.length; j++) {
                      const eventId = clipNodes[j].getAttribute('eventId');
                      const evt = newEvents.find(e => e.id === eventId);
                      if (evt) plEvents.push(evt);
                  }
                  newPlaylists.push({
                      id: node.getAttribute('id') || Date.now().toString(),
                      name: node.getAttribute('name') || 'Imported Playlist',
                      events: plEvents
                  });
              }
              if (newPlaylists.length > 0) setPlaylists(newPlaylists);

              alert('Import Successful!');
          } catch (err) {
              console.error(err);
              alert('Failed to parse XML');
          }
      };
      reader.readAsText(file);
  };

  // --- Tagging Logic ---

  const handleTagClick = (tagId: string) => {
      if (isTaggingMode) {
          if (activeRecording) {
              if (activeRecording.tagId === tagId) {
                  const newEvent: TagEvent = {
                      id: Date.now().toString(),
                      tagId: tagId,
                      startTime: activeRecording.startTime,
                      endTime: currentTime
                  };
                  setTagEvents(prev => [...prev, newEvent]);
                  setActiveRecording(null);
              } else {
                  const newEvent: TagEvent = {
                      id: Date.now().toString(),
                      tagId: activeRecording.tagId,
                      startTime: activeRecording.startTime,
                      endTime: currentTime
                  };
                  setTagEvents(prev => [...prev, newEvent]);
                  setActiveRecording({ tagId, startTime: currentTime });
              }
          } else {
              setActiveRecording({ tagId, startTime: currentTime });
          }
      } else {
          setFilterTagId(current => current === tagId ? null : tagId);
      }
  };

  const cancelRecording = useCallback(() => {
      if (activeRecording) {
          setActiveRecording(null);
      }
  }, [activeRecording]);

  const addSelectedToPlaylist = () => {
    if (selectedEventIds.size === 0) return;
    
    setPlaylists(prev => prev.map(p => {
        if (p.id === activePlaylistId) {
            const newEvents = tagEvents.filter(e => selectedEventIds.has(e.id));
            return { ...p, events: [...p.events, ...newEvents] };
        }
        return p;
    }));
    const btn = document.getElementById('save-playlist-btn');
    if (btn) {
        btn.classList.add('bg-green-500');
        setTimeout(() => btn.classList.remove('bg-green-500'), 500);
    }
  };

  const handleExportTags = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(tags, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "zone14_tags_preset.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImportTags = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedTags = JSON.parse(e.target?.result as string);
            if (Array.isArray(importedTags)) {
                const validTags = importedTags.map((t: any) => ({
                    id: t.id || Date.now().toString() + Math.random(),
                    name: t.name || 'Imported',
                    color: t.color || '#fff',
                    shortcut: t.shortcut || ''
                }));
                setTags(validTags);
                alert("Tags imported successfully!");
            }
        } catch (error) {
            console.error("Invalid tag file");
            alert("Failed to import tags. Invalid file format.");
        }
    };
    reader.readAsText(file);
  };

  const handleEventContextMenu = (e: React.MouseEvent, eventId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, eventId });
  };

  const handleEditEvent = () => {
      if (!contextMenu) return;
      const evt = tagEvents.find(e => e.id === contextMenu.eventId);
      if (evt) {
          setEditEventModal({ 
              isOpen: true, 
              eventId: evt.id, 
              startTime: evt.startTime, 
              endTime: evt.endTime,
              notes: evt.notes || '' 
          });
      }
      setContextMenu(null);
  };

  const saveEditedEvent = () => {
      if (!editEventModal) return;
      setTagEvents(prev => prev.map(e => {
          if (e.id === editEventModal.eventId) {
              return {
                  ...e,
                  startTime: editEventModal.startTime,
                  endTime: editEventModal.endTime,
                  notes: editEventModal.notes
              };
          }
          return e;
      }));
      setEditEventModal(null);
  };

  const handleDeleteEventRequest = () => {
      if (contextMenu) {
        setDeleteConfirmation(contextMenu.eventId);
        setContextMenu(null);
      } else if (editEventModal) {
        setDeleteConfirmation(editEventModal.eventId);
        setEditEventModal(null);
      }
  };

  const confirmDeleteEvent = () => {
      if (deleteConfirmation) {
          setTagEvents(prev => prev.filter(e => e.id !== deleteConfirmation));
          setPlaylists(prev => prev.map(p => ({
              ...p,
              events: p.events.filter(e => e.id !== deleteConfirmation)
          })));
          setDeleteConfirmation(null);
      }
  };

  // --- Keyboard Hotkeys ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const isCtrlOrMeta = e.ctrlKey || e.metaKey;

      const tag = tags.find(t => t.shortcut.toLowerCase() === e.key.toLowerCase());
      if (tag) {
          e.preventDefault();
          if (isTaggingMode) {
              handleTagClick(tag.id);
          } else {
              if (!isTaggingMode) {
                  setIsTaggingMode(true);
                  handleTagClick(tag.id);
              }
          }
          return;
      }

      if (isTaggingMode && e.key === 'Escape') {
          cancelRecording();
          setIsTaggingMode(false);
          return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (videoRef.current) videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 5);
          break;
        case 'KeyZ':
          if (isCtrlOrMeta) {
              e.preventDefault();
              if (e.shiftKey) {
                  redo();
              } else {
                  undo();
              }
          }
          break;
        case 'KeyY':
            if (isCtrlOrMeta) {
                e.preventDefault();
                redo();
            }
            break;
        case 'Delete':
        case 'Backspace':
            e.preventDefault();
            if (selectedEventIds.size > 0) {
                 if (shapes.length > 0) clearAll();
            } else {
                clearAll();
            }
            break;
        case 'KeyA':
            if (isCtrlOrMeta) {
                e.preventDefault();
                setSelectedEventIds(new Set(tagEvents.map(e => e.id)));
            }
            break;
        case 'KeyS':
            if (isCtrlOrMeta) {
                e.preventDefault();
                addSelectedToPlaylist();
            }
            break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPlaying, duration, shapes, redoStack, isTaggingMode, tags, activeRecording, currentTime, tagEvents, selectedEventIds, activePlaylistId, autoplay, contextMenu, editEventModal]); 

  // --- Timeline Markers Logic ---

  const handleTimelineContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!timelineRef.current || duration === 0) return;
    
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const time = percentage * duration;

    setMarkerModal({
        isOpen: true,
        x: e.clientX,
        y: e.clientY - 160,
        mode: 'create',
        time: time,
        tempLabel: '',
        tempColor: '#ef4444' 
    });
  };

  const handleMarkerContextMenu = (e: React.MouseEvent, marker: TimelineMarker) => {
    e.preventDefault();
    e.stopPropagation(); 
    
    setMarkerModal({
        isOpen: true,
        x: e.clientX,
        y: e.clientY - 160,
        mode: 'edit',
        markerId: marker.id,
        tempLabel: marker.label,
        tempColor: marker.color
    });
  };

  const saveMarker = () => {
    if (!markerModal) return;
    
    if (markerModal.mode === 'create' && markerModal.time !== undefined) {
        setMarkers(prev => [...prev, {
            id: Date.now().toString(),
            time: markerModal.time!,
            label: markerModal.tempLabel || 'Marker',
            color: markerModal.tempColor
        }]);
    } else if (markerModal.mode === 'edit' && markerModal.markerId) {
        setMarkers(prev => prev.map(m => m.id === markerModal.markerId ? {
            ...m,
            label: markerModal.tempLabel,
            color: markerModal.tempColor
        } : m));
    }
    setMarkerModal(null);
  };

  const deleteMarker = () => {
      if (markerModal?.markerId) {
          setMarkers(prev => prev.filter(m => m.id !== markerModal.markerId));
          setMarkerModal(null);
      }
  };

  const jumpToMarker = (time: number) => {
      if (videoRef.current) {
          videoRef.current.currentTime = time;
          setCurrentTime(time);
      }
  };

  const handleEventClick = (e: React.MouseEvent, eventId: string, time: number) => {
    e.stopPropagation();
    
    if (videoRef.current) {
        videoRef.current.currentTime = time;
        setCurrentTime(time);
    }
    
    if (e.ctrlKey || e.metaKey) {
        const newSet = new Set(selectedEventIds);
        if (newSet.has(eventId)) newSet.delete(eventId);
        else newSet.add(eventId);
        setSelectedEventIds(newSet);
    } else {
        setSelectedEventIds(new Set([eventId]));
    }
  };


  // --- Masking / Green Screen Logic ---
  const computeMaskingLayers = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !maskSettings.enabled || isPlaying) return;

    setIsProcessingMask(true);

    const width = video.videoWidth;
    const height = video.videoHeight;
    
    if (width === 0 || height === 0) return;

    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = new OffscreenCanvas(width, height);
    }
    const offCtx = offscreenCanvasRef.current.getContext('2d') as OffscreenCanvasRenderingContext2D;
    offscreenCanvasRef.current.width = width;
    offscreenCanvasRef.current.height = height;

    offCtx.drawImage(video, 0, 0, width, height);
    const frameData = offCtx.getImageData(0, 0, width, height);
    const data = frameData.data;

    const foregroundImageData = offCtx.createImageData(width, height);
    const fgData = foregroundImageData.data;
    const overlayImageData = offCtx.createImageData(width, height);
    const ovData = overlayImageData.data;

    const sensitivityThreshold = maskSettings.sensitivity; 
    
    const hMin = 75 - (sensitivityThreshold * 0.4); 
    const hMax = 155 + (sensitivityThreshold * 0.4); 
    const sMin = 0.15;
    const lMin = 0.15;
    const lMax = 0.85;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      const [h, s, l] = rgbToHsl(r, g, b);

      const isGreen = (h >= hMin && h <= hMax) && (s >= sMin) && (l >= lMin && l <= lMax);

      if (isGreen) {
        fgData[i + 3] = 0; 
        ovData[i] = 239; 
        ovData[i + 1] = 68;
        ovData[i + 2] = 68; 
        ovData[i + 3] = 102;
      } else {
        fgData[i] = r;
        fgData[i + 1] = g;
        fgData[i + 2] = b;
        fgData[i + 3] = 255;
        ovData[i + 3] = 0;
      }
    }

    const fgBitmap = await createImageBitmap(foregroundImageData);
    const ovBitmap = await createImageBitmap(overlayImageData);

    setMaskCache({
      foreground: fgBitmap,
      overlay: ovBitmap,
      timestamp: video.currentTime
    });

    setIsProcessingMask(false);
  }, [maskSettings, isPlaying]);

  useEffect(() => {
    if (!isPlaying && maskSettings.enabled) {
      const timeout = setTimeout(() => {
          computeMaskingLayers();
      }, 50);
      return () => clearTimeout(timeout);
    } else if (!maskSettings.enabled && maskCache.foreground) {
      setMaskCache({ foreground: null, overlay: null, timestamp: -1 });
    }
  }, [isPlaying, maskSettings.enabled, maskSettings.sensitivity, currentTime]);

  // --- Capture Sprite Logic (Updated for Video Space) ---
  const captureSprite = async (rect: Rect): Promise<{ sprite: ImageBitmap, patch: ImageBitmap, box: Rect } | null> => {
    // rect is in VIDEO SPACE
    const video = videoRef.current;
    if (!video) return null;
    
    const w = Math.ceil(rect.w);
    const h = Math.ceil(rect.h);
    if (w <= 0 || h <= 0) return null;

    let bgX = rect.x + w * 1.5;
    if (bgX + w > video.videoWidth) {
        bgX = rect.x - w * 1.5;
    }
    if (bgX < 0) bgX = 0;
    const bgY = rect.y;

    const cropCanvas = new OffscreenCanvas(w, h);
    const ctx = cropCanvas.getContext('2d');
    const bgCanvas = new OffscreenCanvas(w, h);
    const bgCtx = bgCanvas.getContext('2d');
    
    if (!ctx || !bgCtx) return null;

    if (maskSettings.enabled && maskCache.foreground) {
        ctx.drawImage(maskCache.foreground, rect.x, rect.y, w, h, 0, 0, w, h);
    } else {
        ctx.drawImage(video, rect.x, rect.y, w, h, 0, 0, w, h);
    }
    bgCtx.drawImage(video, bgX, bgY, w, h, 0, 0, w, h);

    return {
        sprite: await createImageBitmap(cropCanvas),
        patch: await createImageBitmap(bgCanvas),
        box: rect
    };
  };

  // --- Drawing Logic ---

  const getVideoSpacePoint = (e: React.MouseEvent | MouseEvent): Point => {
    if (!canvasRef.current || !videoRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const layout = getVideoLayout(canvasRef.current, videoRef.current);
    
    // Invert transform to get video space
    // x_canvas = x_video * scale + layout.x
    // x_video = (x_canvas - layout.x) / scale
    
    return {
        x: (x - layout.x) / layout.scale,
        y: (y - layout.y) / layout.scale
    };
  };

  const startDrawing = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (tool === null) return; 
    if (tool === 'masking') return;

    if (isPlaying) togglePlay();
    if (videoRef.current && !videoRef.current.paused) {
       videoRef.current.pause();
       setIsPlaying(false);
    }

    const startPoint = getVideoSpacePoint(e);
    
    if (tool === 'player-move') {
        if (playerMoveState === 'idle') {
            setPlayerSelectionRect({ x: startPoint.x, y: startPoint.y, w: 0, h: 0 });
            setPlayerMoveState('selecting');
        } else if (playerMoveState === 'moving') {
            finishDrawing(e);
        }
        return;
    }
    if (tool === 'spotlight' || tool === 'lens') {
         setIsDrawing(true);
         return;
    }
    if (tool === 'connected-circle') {
        setCurrentDragStart(startPoint);
        setIsDrawing(true);
    } else if (tool === 'circle') {
        setCurrentDragStart(startPoint);
        setIsDrawing(true);
        setActivePoints([startPoint]);
    } else if (tool === 'polygon') {
      setActivePoints(prev => [...prev, startPoint]);
    } else if (tool === 'pen') {
      setIsDrawing(true);
      setActivePoints([startPoint]);
    } else if (tool === 'arrow' && arrowSettings.isFreehand) {
        setIsDrawing(true);
        setActivePoints([startPoint]);
    } else {
      setIsDrawing(true);
      setActivePoints([startPoint]);
    }
  };

  const drawPreview = (e: React.MouseEvent) => {
    if (tool === 'masking') return;
    const currentPoint = getVideoSpacePoint(e);
    mousePosRef.current = currentPoint; // Store for render loop

    if (tool === 'player-move') {
        if (playerMoveState === 'selecting' && playerSelectionRect) {
            const w = currentPoint.x - playerSelectionRect.x;
            const h = currentPoint.y - playerSelectionRect.y;
            // Update preview rect - but actual rect is stored in state only on finish?
            // No, we need to re-render to see selection box.
            // Force re-render not efficient here?
            // Actually, we can use renderCanvas to draw the selection box from a ref?
            // But we used state for selection rect.
            // Let's rely on renderCanvas picking up mousePosRef for dynamic drag, 
            // but for selection box (dragging), we might need local state update if we want exact rect.
            // Or we just calculate it in renderCanvas using currentDragStart? 
            // Player selection uses playerSelectionRect state which is start point + width/height.
            // Let's just trigger render.
        }
        return;
    }

    if (!isDrawing && tool === 'connected-circle') {
       // Just needs mousePosRef update for ghost line
       return;
    }

    if (isDrawing && (tool === 'pen' || (tool === 'arrow' && arrowSettings.isFreehand))) {
        setActivePoints(prev => [...prev, currentPoint]);
        return;
    }
    
    // For other tools, we rely on renderCanvas loop using mousePosRef
  };

  const finishDrawing = (e: React.MouseEvent) => {
    if (tool === null || tool === 'masking') return;
    const currentPoint = getVideoSpacePoint(e);

    if (tool === 'player-move') {
        if (playerMoveState === 'selecting' && playerSelectionRect) {
            const w = currentPoint.x - playerSelectionRect.x;
            const h = currentPoint.y - playerSelectionRect.y;
            if (Math.abs(w) < 10 || Math.abs(h) < 10) {
                setPlayerMoveState('idle');
                setPlayerSelectionRect(null);
                return;
            }
            const finalRect: Rect = {
                x: w > 0 ? playerSelectionRect.x : currentPoint.x,
                y: h > 0 ? playerSelectionRect.y : currentPoint.y,
                w: Math.abs(w),
                h: Math.abs(h)
            };
            captureSprite(finalRect).then(result => {
                if (result) {
                    setCapturedSprite(result);
                    setPlayerMoveState('moving');
                } else {
                    setPlayerMoveState('idle');
                }
            });
            setPlayerSelectionRect(null);
        } else if (playerMoveState === 'moving' && capturedSprite) {
            const { box } = capturedSprite;
            const destCenter = currentPoint;
             const newShape: Shape = {
                id: Date.now().toString(),
                type: 'player-move',
                points: [ { x: box.x + box.w/2, y: box.y + box.h/2 }, destCenter ], 
                box: box,
                color: currentColor,
                strokeWidth: strokeWidth,
                img: capturedSprite.sprite,
                bgImg: capturedSprite.patch,
                timestamp: Date.now()
             };
             addShape(newShape);
             setPlayerMoveState('idle');
             setCapturedSprite(null);
        }
        return;
    }
    if (tool === 'spotlight' && isDrawing) {
        setIsDrawing(false);
        const newShape: Shape = {
            id: Date.now().toString(),
            type: 'spotlight',
            points: [currentPoint],
            color: '#ffffff',
            strokeWidth: 1,
            timestamp: Date.now(),
            spotlightConfig: {
                size: spotlightSettings.size,
                intensity: spotlightSettings.intensity,
                rotation: spotlightSettings.rotation,
                particles: createParticles(30)
            }
        };
        addShape(newShape);
        return;
    }
    if (tool === 'lens' && isDrawing) {
        setIsDrawing(false);
        const newShape: Shape = {
            id: Date.now().toString(),
            type: 'lens',
            points: [currentPoint],
            color: '#ffffff',
            strokeWidth: 1,
            timestamp: Date.now(),
            lensConfig: {
                radius: lensSettings.size,
                zoom: lensSettings.zoom
            }
        };
        addShape(newShape);
        return;
    }
    if (tool === 'connected-circle') {
        if (isDrawing && currentDragStart) {
            const radius = getDistance(currentDragStart, currentPoint);
            if (activePoints.length >= 2) {
                const distToStart = getDistance(currentPoint, activePoints[0]);
                if (distToStart < 40) { // Threshold in video space? Might need adjustment
                     const newShape: Shape = {
                        id: Date.now().toString(),
                        type: 'connected-circle',
                        points: [...activePoints], 
                        color: currentColor,
                        strokeWidth: strokeWidth,
                        timestamp: Date.now(),
                        ringConfig: { tilt: ringSettings.tilt },
                        isClosed: true,
                        isFilled: ringSettings.isFilled
                    };
                    addShape(newShape);
                    setActivePoints([]);
                    setIsDrawing(false);
                    setCurrentDragStart(null);
                    return;
                }
            }
            if (radius > 5) {
                setActivePoints(prev => [...prev, { x: currentDragStart.x, y: currentDragStart.y, r: radius, timestamp: Date.now() }]);
            }
            setIsDrawing(false);
            setCurrentDragStart(null);
        }
        return;
    }
    if (tool === 'polygon') return; 
    if (isDrawing) {
      setIsDrawing(false);
      let pointsToSave = [activePoints[0], currentPoint];
      if (tool === 'circle' && currentDragStart) {
          pointsToSave = [currentDragStart, currentPoint];
      }
      if (tool === 'pen' || (tool === 'arrow' && arrowSettings.isFreehand)) {
          pointsToSave = [...activePoints, currentPoint];
      }
      const newShape: Shape = {
        id: Date.now().toString(),
        type: tool,
        points: pointsToSave,
        color: currentColor,
        strokeWidth: strokeWidth,
        isDashed: arrowSettings.isDashed,
        isFreehand: arrowSettings.isFreehand,
        timestamp: Date.now(),
        ringConfig: (tool === 'circle') ? { tilt: ringSettings.tilt } : undefined
      };
      addShape(newShape);
      setActivePoints([]);
      setCurrentDragStart(null);
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (tool === 'polygon' && activePoints.length > 2) {
        const newShape: Shape = { id: Date.now().toString(), type: tool, points: [...activePoints], color: currentColor, strokeWidth: strokeWidth, isClosed: true, timestamp: Date.now() };
        addShape(newShape);
        setActivePoints([]);
    }
    if (tool === 'connected-circle') {
        if (activePoints.length > 0) {
            const newShape: Shape = { id: Date.now().toString(), type: 'connected-circle', points: [...activePoints], color: currentColor, strokeWidth: strokeWidth, timestamp: 0, ringConfig: { tilt: ringSettings.tilt }, isClosed: false };
            addShape(newShape);
        }
        setActivePoints([]);
        setIsDrawing(false);
        setCurrentDragStart(null);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault();
      if (activePoints.length > 0 || isDrawing || playerMoveState !== 'idle') {
          setActivePoints([]);
          setIsDrawing(false);
          setPlayerMoveState('idle');
          setPlayerSelectionRect(null);
          setCapturedSprite(null);
          setCurrentDragStart(null);
          renderCanvas(); 
      }
  };

  const addShape = (shape: Shape) => {
    const newShapes = [...shapes, shape];
    setShapes(newShapes);
    setRedoStack([]); 
  };

  const undo = () => {
    if (shapes.length === 0) return;
    const last = shapes[shapes.length - 1];
    setRedoStack([...redoStack, [last]]); 
    setShapes(shapes.slice(0, -1));
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const nextGroup = redoStack[redoStack.length - 1];
    const next = nextGroup[0]; 
    setShapes([...shapes, next]);
    setRedoStack(redoStack.slice(0, -1));
  };

  const clearAll = () => {
    setShapes([]);
    setRedoStack([]);
    setActivePoints([]);
    setIsDrawing(false);
    setCurrentDragStart(null);
    setPlayerMoveState('idle');
    setPlayerSelectionRect(null);
    setCapturedSprite(null);
  };

  const confirmClose = () => {
      onClose();
  };

  const drawActiveChain = (ctx: CanvasRenderingContext2D, scale: number) => {
    if (tool !== 'connected-circle' || activePoints.length === 0) return;
    const now = Date.now();
    if (activePoints.length > 1) {
      for (let i = 0; i < activePoints.length - 1; i++) {
        const c1 = activePoints[i];
        const c2 = activePoints[i + 1];
        const startTime = c2.timestamp || 0;
        const pulseAge = Math.max(0, now - startTime);
        drawTangentLine(ctx, c1, c2, c1.r || 40, c2.r || 40, currentColor, strokeWidth / scale, 1, pulseAge);
      }
    }
    activePoints.forEach(p => {
      draw3DRing(ctx, p.x, p.y, p.r || 40, currentColor, ringSettings.tilt, strokeWidth / scale, p.timestamp || now);
    });
  };

  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !videoRef.current) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const video = videoRef.current;

    // 1. Calculate Layout
    const layout = getVideoLayout(canvas, video);
    const { x, y, w, h, scale } = layout;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 2. Draw Masking (if active) - Full Screen Image
    const currentVideoTime = video ? video.currentTime : 0;
    const isMaskSynced = maskCache.timestamp !== -1 && Math.abs(maskCache.timestamp - currentVideoTime) < 0.15;
    
    if (maskSettings.enabled && !isPlaying && maskSettings.showOverlay && maskCache.overlay && isMaskSynced) {
        ctx.drawImage(maskCache.overlay, x, y, w, h);
    }

    // 3. Apply Transform for Shapes
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // 4. Draw Persistent Shapes
    shapes.forEach(shape => {
        if (shape.type === 'player-move' || shape.type === 'lens') return; 
        if (shape.type === 'curved-arrow') drawShapeOnCanvas(shape, scale, 'shadow');
        else drawShapeOnCanvas(shape, scale);
    });

    // 5. Draw Active Tool Previews (Ghosting)
    // DISABLED per user request: "Except mouse pointer no trace should visible while drawing"
    // The previous logic for previews/ghosting has been removed.

    // 6. Restore Context (End Video Space)
    ctx.restore();

    // 7. Draw Masking Foreground (Video Space) - Re-apply mask for foreground
    if (maskSettings.enabled && !isPlaying && maskCache.foreground && isMaskSynced) {
        ctx.drawImage(maskCache.foreground, x, y, w, h);
    }
    
    // 8. Draw Complex Shapes that need layering (Lens / Player Move on top of everything)
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    
    shapes.forEach(shape => {
        if (shape.type === 'curved-arrow') drawShapeOnCanvas(shape, scale, 'body');
        if (shape.type === 'player-move') drawShapeOnCanvas(shape, scale);
        if (shape.type === 'lens' && video) {
            if (shape.lensConfig && shape.points[0]) {
                drawLens(ctx, shape.points[0], shape.lensConfig.radius, shape.lensConfig.zoom, video, scale);
            }
        }
    });
    ctx.restore();

  }, [shapes, isDrawing, activePoints, tool, currentColor, strokeWidth, maskSettings, maskCache, isPlaying, playerMoveState, ringSettings.tilt, arrowSettings, spotlightSettings, lensSettings]);

  useEffect(() => {
    let animationFrameId: number;
    const animate = () => {
        renderCanvas();
        animationFrameId = requestAnimationFrame(animate);
    };
    animate();
    return () => cancelAnimationFrame(animationFrameId);
  }, [renderCanvas]); // Render loop depends on renderCanvas closure

  const drawShapeOnCanvas = (shape: Shape, scale: number, renderMode: 'full' | 'shadow' | 'body' = 'full') => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // NOTE: ctx is already transformed to Video Space
    // All dimensions must be divided by scale to maintain screen visual size
    
    ctx.save(); 
    if (shape.timestamp > 0 && shape.type !== 'curved-arrow' && shape.type !== 'player-move' && shape.type !== 'spotlight' && shape.type !== 'lens' && shape.type !== 'arrow') {
        const age = Date.now() - shape.timestamp;
        const fadeDuration = 300; 
        if (age < fadeDuration) ctx.globalAlpha = Math.min(1, age / fadeDuration);
        else ctx.globalAlpha = 1;
    }
    
    ctx.strokeStyle = shape.color;
    ctx.lineWidth = shape.strokeWidth / scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.fillStyle = shape.color;
    
    const { points, type } = shape;
    if (points.length < 1) { ctx.restore(); return; }
    const p1 = points[0];
    const p2 = points[points.length - 1];
    
    ctx.beginPath();
    switch (type) {
        case 'pen':
            if (points.length < 2) { ctx.beginPath(); ctx.arc(points[0].x, points[0].y, (shape.strokeWidth / scale) / 2, 0, Math.PI * 2); ctx.fill(); } 
            else { ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); for (let i = 1; i < points.length - 2; i++) { const xc = (points[i].x + points[i + 1].x) / 2; const yc = (points[i].y + points[i + 1].y) / 2; ctx.quadraticCurveTo(points[i].x, points[i].y, xc, yc); } if (points.length > 2) ctx.quadraticCurveTo(points[points.length - 2].x, points[points.length - 2].y, points[points.length - 1].x, points[points.length - 1].y); else ctx.lineTo(points[1].x, points[1].y); ctx.stroke(); }
            break;
        case 'line': ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke(); break;
        case 'arrow': if (shape.isFreehand) drawFreehandArrow(ctx, points, shape.color, shape.strokeWidth / scale, shape.isDashed || false, shape.timestamp, false); else drawProArrow(ctx, p1, p2, shape.color, shape.strokeWidth / scale, shape.isDashed || false, shape.timestamp); break;
        case 'curved-arrow': drawCurvedArrow(ctx, p1, p2, shape.color, shape.strokeWidth / scale, shape.isDashed || false, shape.timestamp, renderMode); break;
        case 'circle': const radius = getDistance(p1, p2); draw3DRing(ctx, p1.x, p1.y, radius, shape.color, shape.ringConfig?.tilt ?? 65, shape.strokeWidth / scale, shape.timestamp); break;
        case 'polygon': if (points.length < 1) break; ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); points.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); if (shape.isClosed) { ctx.closePath(); ctx.save(); ctx.globalAlpha = ctx.globalAlpha * 0.2; ctx.fillStyle = shape.color; ctx.fill(); ctx.restore(); } ctx.stroke(); ctx.save(); points.forEach(p => { ctx.beginPath(); ctx.fillStyle = shape.color; ctx.arc(p.x, p.y, 4 / scale, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 2 / scale; ctx.strokeStyle = '#ffffff'; ctx.stroke(); }); ctx.restore(); break;
        case 'connected-circle': const now = Date.now(); if (shape.isClosed && shape.isFilled && points.length > 2) { ctx.save(); ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y); points.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath(); ctx.fillStyle = fadeColor(shape.color, 0.2); ctx.fill(); ctx.restore(); } if (points.length > 1) { for (let i = 0; i < points.length - 1; i++) { const c1 = points[i]; const c2 = points[i + 1]; const startTime = c2.timestamp || shape.timestamp || 0; const pulseAge = Math.max(0, now - startTime); drawTangentLine(ctx, c1, c2, c1.r || 40, c2.r || 40, shape.color, shape.strokeWidth / scale, 1, pulseAge); } if (shape.isClosed) { const last = points[points.length - 1]; const first = points[0]; const startTime = shape.timestamp || 0; const pulseAge = Math.max(0, now - startTime); drawTangentLine(ctx, last, first, last.r || 40, first.r || 40, shape.color, shape.strokeWidth / scale, 1, pulseAge); } } points.forEach(p => { draw3DRing(ctx, p.x, p.y, p.r || 40, shape.color, shape.ringConfig?.tilt ?? 65, shape.strokeWidth / scale, p.timestamp || shape.timestamp); }); break;
        case 'player-move': if (shape.img && shape.box && points.length >= 2) { const originCenter = points[0]; const destCenter = points[1]; const { w, h } = shape.box; if (shape.bgImg) ctx.drawImage(shape.bgImg, shape.box.x, shape.box.y, w, h); ctx.beginPath(); ctx.strokeStyle = shape.color; ctx.lineWidth = shape.strokeWidth / scale; ctx.moveTo(originCenter.x, originCenter.y); ctx.lineTo(destCenter.x, destCenter.y); ctx.stroke(); drawArrowHead(ctx, originCenter, destCenter, (shape.strokeWidth * 4) / scale); ctx.save(); ctx.shadowColor = 'black'; ctx.shadowBlur = 10 / scale; ctx.drawImage(shape.img, destCenter.x - w/2, destCenter.y - h/2, w, h); ctx.restore(); } break;
        case 'spotlight': if (shape.spotlightConfig) drawSpotlight(ctx, points[0].x, points[0].y, shape.spotlightConfig.size, shape.spotlightConfig.intensity, shape.spotlightConfig.rotation, shape.spotlightConfig.particles, shape.timestamp); break;
    }
    ctx.restore();
  };

  useEffect(() => {
    const syncSize = () => {
      if (containerRef.current && canvasRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        canvasRef.current.width = clientWidth;
        canvasRef.current.height = clientHeight;
        // renderCanvas called by loop
      }
    };
    const resizeObserver = new ResizeObserver(syncSize);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    window.addEventListener('resize', syncSize);
    syncSize();
    return () => {
        window.removeEventListener('resize', syncSize);
        resizeObserver.disconnect();
    };
  }, [videoUrl, viewMode]); // Re-sync when view mode changes

  const handleColorRightClick = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    const input = document.createElement('input');
    input.type = 'color';
    input.value = colors.find(c => c.id === id)?.value || '#ffffff';
    input.onchange = (ev) => {
      const val = (ev.target as HTMLInputElement).value;
      setColors(prev => prev.map(c => c.id === id ? { ...c, value: val } : c));
    };
    input.click();
  };

  const renderPropertiesPanel = () => {
      // ... (Properties Panel logic is fine)
      switch(tool) {
        case 'circle':
        case 'connected-circle':
            return (
                <div className="space-y-6">
                     <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-cyan-500/20 rounded-lg">
                            {tool === 'circle' ? <Circle className="w-5 h-5 text-cyan-500" /> : <GitCommitVertical className="w-5 h-5 text-cyan-500" />}
                        </div>
                        <div>
                            <h3 className="font-semibold text-white">{tool === 'circle' ? 'Ring Properties' : 'Chain Properties'}</h3>
                            <p className="text-xs text-gray-400">Tilt & Spin</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Tilt (Perspective)</span>
                            <span>{ringSettings.tilt}°</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="89"
                            step="1"
                            value={ringSettings.tilt}
                            onChange={(e) => setRingSettings(s => ({ ...s, tilt: parseInt(e.target.value) }))}
                            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500"
                        />
                    </div>
                    {tool === 'connected-circle' && (
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-gray-300">Fill Shape (Closed)</span>
                            <button 
                                onClick={() => setRingSettings(s => ({ ...s, isFilled: !s.isFilled }))}
                                className={`w-12 h-6 rounded-full relative transition-colors ${
                                    ringSettings.isFilled ? 'bg-cyan-500' : 'bg-gray-700'
                                }`}
                            >
                                <motion.div 
                                    className="w-4 h-4 bg-white rounded-full absolute top-1"
                                    animate={{ left: ringSettings.isFilled ? 'calc(100% - 20px)' : '4px' }}
                                />
                            </button>
                        </div>
                    )}
                     <div className="space-y-3">
                         <div className="flex justify-between text-xs text-gray-400">
                            <span>Stroke Thickness</span>
                            <span>{strokeWidth}px</span>
                        </div>
                        <input
                            type="range"
                            min="1"
                            max="20"
                            step="1"
                            value={strokeWidth}
                            onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-cyan-500"
                        />
                    </div>
                </div>
            );
        case 'spotlight':
            return (
                <div className="space-y-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-yellow-500/20 rounded-lg">
                            <Flashlight className="w-5 h-5 text-yellow-500" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-white">Spotlight</h3>
                            <p className="text-xs text-gray-400">Beam & 3D Ring</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Beam Size</span>
                            <span>{spotlightSettings.size}px</span>
                        </div>
                        <input
                            type="range"
                            min="30"
                            max="200"
                            value={spotlightSettings.size}
                            onChange={(e) => setSpotlightSettings(s => ({ ...s, size: parseInt(e.target.value) }))}
                            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                        />
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Intensity</span>
                            <span>{(spotlightSettings.intensity * 100).toFixed(0)}%</span>
                        </div>
                        <input
                            type="range"
                            min="0.1"
                            max="1.0"
                            step="0.05"
                            value={spotlightSettings.intensity}
                            onChange={(e) => setSpotlightSettings(s => ({ ...s, intensity: parseFloat(e.target.value) }))}
                            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                        />
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Tilt (Perspective)</span>
                            <span>{spotlightSettings.rotation.toFixed(2)}</span>
                        </div>
                        <input
                            type="range"
                            min="0.2"
                            max="1.0"
                            step="0.05"
                            value={spotlightSettings.rotation}
                            onChange={(e) => setSpotlightSettings(s => ({ ...s, rotation: parseFloat(e.target.value) }))}
                            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                        />
                    </div>
                </div>
            );
        case 'lens':
            return (
                <div className="space-y-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-blue-500/20 rounded-lg">
                            <ZoomIn className="w-5 h-5 text-blue-500" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-white">Zoom Lens</h3>
                            <p className="text-xs text-gray-400">Magnify Details</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Lens Size (Radius)</span>
                            <span>{lensSettings.size}px</span>
                        </div>
                        <input
                            type="range"
                            min="50"
                            max="200"
                            value={lensSettings.size}
                            onChange={(e) => setLensSettings(s => ({ ...s, size: parseInt(e.target.value) }))}
                            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                        />
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Zoom Depth</span>
                            <span>{lensSettings.zoom.toFixed(1)}x</span>
                        </div>
                        <input
                            type="range"
                            min="1.1"
                            max="4.0"
                            step="0.1"
                            value={lensSettings.zoom}
                            onChange={(e) => setLensSettings(s => ({ ...s, zoom: parseFloat(e.target.value) }))}
                            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500"
                        />
                    </div>
                </div>
            );
        case 'masking':
            return (
                <div className="space-y-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-green-500/20 rounded-lg">
                            <Layers className="w-5 h-5 text-green-500" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-white">Masking Properties</h3>
                            <p className="text-xs text-gray-400">Green Screen Keying</p>
                        </div>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-300">Enable Green Screen</span>
                        <button 
                            onClick={() => setMaskSettings(s => ({ ...s, enabled: !s.enabled }))}
                            className={`w-12 h-6 rounded-full relative transition-colors ${
                                maskSettings.enabled ? 'bg-green-500' : 'bg-gray-700'
                            }`}
                        >
                            <motion.div 
                                className="w-4 h-4 bg-white rounded-full absolute top-1"
                                animate={{ left: maskSettings.enabled ? 'calc(100% - 20px)' : '4px' }}
                            />
                        </button>
                    </div>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-300">Show Detection Overlay</span>
                        </div>
                        <button 
                            onClick={() => setMaskSettings(s => ({ ...s, showOverlay: !s.showOverlay }))}
                            disabled={!maskSettings.enabled}
                            className={`p-2 rounded-lg transition-colors ${
                                maskSettings.showOverlay ? 'bg-blue-600/20 text-blue-400' : 'bg-gray-800 text-gray-500'
                            } disabled:opacity-50`}
                        >
                            {maskSettings.showOverlay ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                        </button>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between text-xs text-gray-400">
                            <span>Sensitivity</span>
                            <span>{maskSettings.sensitivity}%</span>
                        </div>
                        <div className="relative h-6 flex items-center">
                            <SlidersHorizontal className="absolute left-0 w-4 h-4 text-gray-500 z-10 pointer-events-none" />
                            <input
                                type="range"
                                min="0"
                                max="100"
                                disabled={!maskSettings.enabled}
                                value={maskSettings.sensitivity}
                                onChange={(e) => setMaskSettings(s => ({ ...s, sensitivity: parseInt(e.target.value) }))}
                                className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 disabled:opacity-50 pl-6"
                            />
                        </div>
                    </div>
                    <div className="pt-4 border-t border-[#333]">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Layer Architecture</p>
                        <div className="space-y-2 text-xs text-gray-400">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                <span>Top: Players (Foreground)</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-yellow-500"></div>
                                <span>Middle: Drawings</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-red-500"></div>
                                <span>Bottom: Pitch (Overlay)</span>
                            </div>
                        </div>
                    </div>
                </div>
            );
        case 'pen':
        case 'line':
        case 'arrow':
        case 'curved-arrow':
        case 'polygon':
        case 'player-move':
            return (
                <div className="space-y-6">
                    <div className="flex items-center gap-3 mb-6">
                         <div className="p-2 bg-indigo-500/20 rounded-lg">
                            <Settings2 className="w-5 h-5 text-indigo-500" />
                        </div>
                        <div>
                            <h3 className="font-semibold text-white">Tool Settings</h3>
                            <p className="text-xs text-gray-400">Stroke Properties</p>
                        </div>
                    </div>
                    {(tool === 'arrow' || tool === 'curved-arrow') && (
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <span className="text-xs text-gray-400">Line Style</span>
                                <div className="flex bg-[#222] p-1 rounded-lg">
                                    <button 
                                        onClick={() => setArrowSettings(s => ({...s, isDashed: false}))}
                                        className={`flex-1 py-1.5 flex items-center justify-center rounded-md transition-all ${!arrowSettings.isDashed ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'}`}
                                        title="Solid"
                                    >
                                        <Minus className="w-4 h-4" />
                                    </button>
                                    <button 
                                        onClick={() => setArrowSettings(s => ({...s, isDashed: true}))}
                                        className={`flex-1 py-1.5 flex items-center justify-center rounded-md transition-all ${arrowSettings.isDashed ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'}`}
                                        title="Dashed"
                                    >
                                        <MoreHorizontal className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            {tool === 'arrow' && (
                                <div className="space-y-2">
                                    <span className="text-xs text-gray-400">Draw Mode</span>
                                    <div className="flex bg-[#222] p-1 rounded-lg">
                                        <button 
                                            onClick={() => setArrowSettings(s => ({...s, isFreehand: false}))}
                                            className={`flex-1 py-1.5 flex items-center justify-center rounded-md transition-all ${!arrowSettings.isFreehand ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'}`}
                                            title="Straight Arrow"
                                        >
                                            <MoveUpRight className="w-4 h-4" />
                                        </button>
                                        <button 
                                            onClick={() => setArrowSettings(s => ({...s, isFreehand: true}))}
                                            className={`flex-1 py-1.5 flex items-center justify-center rounded-md transition-all ${arrowSettings.isFreehand ? 'bg-indigo-600 text-white shadow-lg' : 'text-gray-400 hover:text-gray-200'}`}
                                            title="Freehand Arrow"
                                        >
                                            <Activity className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    <div className="space-y-3">
                         <div className="flex justify-between text-xs text-gray-400">
                            <span>Stroke Thickness</span>
                            <span>{strokeWidth}px</span>
                        </div>
                        <input
                            type="range"
                            min="1"
                            max="20"
                            step="1"
                            value={strokeWidth}
                            onChange={(e) => setStrokeWidth(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-500"
                        />
                    </div>
                </div>
            );
        default:
            return null;
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#0e0e0e] relative">
      {/* Top Bar */}
      <div className="h-14 bg-[#111] border-b border-[#222] flex items-center justify-between px-4 z-20 shrink-0 gap-4">
        {/* Left: Branding & View Toggle */}
        <div className="flex items-center gap-6 shrink-0">
          <div className="flex items-center gap-4">
            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
                Zone 14
            </span>
            <div className="h-6 w-[1px] bg-[#333]" />
          </div>

          {/* Video / Slides Toggle */}
          <div className="flex items-center gap-2 bg-[#1a1a1a] rounded-lg p-1 border border-[#333]">
             <button
                onClick={() => setViewMode('video')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-2 text-sm font-semibold transition-all ${
                    viewMode === 'video' 
                    ? 'bg-[#2a2a2a] text-white shadow-lg' 
                    : 'text-gray-400 hover:text-gray-200'
                }`}
             >
                <Video className="w-4 h-4" />
                VIDEO
             </button>
             <button
                onClick={() => setViewMode('slides')}
                className={`px-3 py-1.5 rounded-md flex items-center gap-2 text-sm font-semibold transition-all ${
                    viewMode === 'slides' 
                    ? 'bg-[#2a2a2a] text-white shadow-lg' 
                    : 'text-gray-400 hover:text-gray-200'
                }`}
             >
                <Presentation className="w-4 h-4" />
                SLIDES
             </button>
          </div>
        </div>

        {/* Action Buttons (Undo/Redo/Delete) */}
        {viewMode === 'video' && (
            <div className="flex items-center gap-1">
                <button onClick={undo} className="p-2 hover:bg-[#222] rounded text-gray-300 hover:text-white transition-colors" title="Undo (Ctrl+Z)">
                    <Undo2 className="w-5 h-5" />
                </button>
                <button onClick={redo} className="p-2 hover:bg-[#222] rounded text-gray-300 hover:text-white transition-colors" title="Redo (Ctrl+Y)">
                    <Redo2 className="w-5 h-5" />
                </button>
                <div className="h-4 w-[1px] bg-[#333] mx-2" />
                <button onClick={clearAll} className="p-2 hover:bg-red-900/30 rounded text-gray-300 hover:text-red-400 transition-colors" title="Clear All (Del)">
                    <Trash2 className="w-5 h-5" />
                </button>
            </div>
        )}

        {/* Slides URL Input */}
        {viewMode === 'slides' && (
            <div className="flex-1 max-w-xl px-4">
                 <div className="relative group">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input 
                        type="text" 
                        value={slideUrl}
                        onChange={(e) => setSlideUrl(e.target.value)}
                        placeholder="Enter Slides URL (e.g., Canva embed link)"
                        className="w-full bg-[#111] border border-[#333] text-gray-300 text-sm rounded-full py-1.5 pl-9 pr-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all"
                    />
                 </div>
            </div>
        )}

        <div className="flex-1" />

        {/* Right: Colors & Close */}
        <div className="flex items-center gap-6">
            {viewMode === 'video' && (
                <div className="flex items-center gap-2">
                    {colors.map((color) => (
                    <button
                        key={color.id}
                        onClick={() => setActiveColorId(color.id)}
                        onContextMenu={(e) => handleColorRightClick(e, color.id)}
                        className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                        activeColorId === color.id ? 'border-white scale-125' : 'border-transparent ring-1 ring-white/10'
                        }`}
                        style={{ backgroundColor: color.value }}
                        title="Left-click to select, Right-click to edit"
                    />
                    ))}
                </div>
            )}

            <div className="h-6 w-[1px] bg-[#333]" />
            
            <button 
            onClick={() => setShowCloseConfirm(true)}
            className="p-2 hover:bg-red-500/10 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
            >
            <X className="w-5 h-5" />
            </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar Container - Tools + Fixed Properties */}
        <div className="flex h-full shrink-0 z-30 relative">
            {/* Tool Icon Strip (Fixed) */}
            <div className="w-16 bg-[#111] border-r border-[#222] flex flex-col items-center py-4 gap-2 z-40 overflow-y-auto no-scrollbar">
                {[
                { id: 'pen', icon: Pen, label: 'Freehand Pen' },
                { id: 'line', icon: Minus, label: 'Line' },
                { id: 'arrow', icon: MoveUpRight, label: 'Arrow' },
                { id: 'curved-arrow', icon: CornerUpRight, label: 'Curved Arrow' },
                { id: 'circle', icon: Circle, label: 'Telestration Ring' },
                { id: 'connected-circle', icon: GitCommitVertical, label: 'Chain' },
                { id: 'spotlight', icon: Flashlight, label: 'Spotlight' },
                { id: 'lens', icon: ZoomIn, label: 'Zoom Lens' },
                { id: 'player-move', icon: User, label: 'Player Dragger' },
                { id: 'polygon', icon: Hexagon, label: 'Polygon' },
                { id: 'masking', icon: Layers, label: 'Masking / Green Screen' },
                ].map((item) => (
                    <div key={item.id} className="relative group w-full flex justify-center">
                        <button
                            onClick={() => {
                                if (viewMode === 'slides') return; // Disable tools in slide mode
                                if (item.id === 'masking') {
                                    setTool(tool === 'masking' ? null : 'masking');
                                } else {
                                    setTool(tool === item.id ? null : item.id as ToolType);
                                }
                            }}
                            disabled={viewMode === 'slides'}
                            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                            tool === item.id 
                                ? 'bg-blue-600/20 text-blue-400 ring-2 ring-blue-500/50' 
                                : 'text-gray-400 hover:bg-[#222] hover:text-white'
                            } ${viewMode === 'slides' ? 'opacity-30 cursor-not-allowed' : ''}`}
                        >
                            <item.icon className={`w-5 h-5 ${tool === item.id ? 'stroke-[2.5px]' : ''}`} />
                        </button>
                        
                        {viewMode === 'video' && (
                            <div className="absolute left-full ml-3 px-3 py-1.5 bg-gray-800 text-white text-xs font-medium rounded-md opacity-0 group-hover:opacity-100 group-hover:scale-100 scale-95 pointer-events-none transition-all duration-200 transform translate-x-[-10px] group-hover:translate-x-0 whitespace-nowrap z-50 shadow-xl border border-gray-700 flex items-center origin-left">
                                {item.label}
                                <div className="absolute right-full top-1/2 -translate-y-1/2 -mr-[1px] border-8 border-transparent border-r-gray-800"></div>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Fixed Properties Panel (Non-collapsible) */}
            <div className="w-[240px] bg-[#161616] border-r border-[#222] flex flex-col shrink-0 z-30 transition-opacity duration-300">
                <div className="h-14 border-b border-[#222] flex items-center px-4 shrink-0">
                    <span className="text-sm font-semibold text-gray-300">Properties</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4">
                    {viewMode === 'slides' ? (
                        <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-50">
                            <Presentation className="w-12 h-12 text-gray-600" />
                            <p className="text-xs text-gray-500">Presentation Mode Active</p>
                        </div>
                    ) : (
                        renderPropertiesPanel() || (
                            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-50">
                                <MousePointer2 className="w-12 h-12 text-gray-600" />
                                <p className="text-xs text-gray-500">Select a tool to configure properties</p>
                            </div>
                        )
                    )}
                </div>
            </div>
        </div>

        {/* Main Content Area: Canvas + Controls + Iframe (Stacked) */}
        <div className="flex-1 flex flex-col min-w-0 bg-[#0a0a0a] relative">
            
            {/* Video Canvas Layer */}
            <div 
                className="flex-1 flex flex-col h-full relative"
                style={{ display: viewMode === 'video' ? 'flex' : 'none' }}
            >
                {/* Canvas Container */}
                <div ref={containerRef} className="flex-1 relative flex items-center justify-center overflow-hidden bg-black">
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        className="absolute max-w-none max-h-none"
                        style={{ 
                        width: containerRef.current ? '100%' : 'auto',
                        height: '100%',
                        objectFit: 'contain'
                        }}
                        onTimeUpdate={handleTimeUpdate}
                        onLoadedMetadata={handleLoadedMetadata}
                        onEnded={() => setIsPlaying(false)}
                        disablePictureInPicture
                        controls={false}
                    />
                    <canvas
                        ref={canvasRef}
                        className={`absolute inset-0 z-10 touch-none ${tool === 'masking' ? 'cursor-default' : (tool ? 'cursor-crosshair' : 'cursor-default')}`}
                        onMouseDown={startDrawing}
                        onMouseMove={drawPreview}
                        onMouseUp={finishDrawing}
                        onMouseLeave={() => { setIsDrawing(false); mousePosRef.current = null; }}
                        onDoubleClick={handleDoubleClick}
                        onContextMenu={handleContextMenu}
                    />
                </div>

                {/* Bottom Controls Bar (Visible only in Video Mode) */}
                <div className="h-20 bg-[#111] border-t border-[#222] px-6 flex items-center gap-6 shrink-0 z-20">
                    {/* Playback Controls */}
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => { if(videoRef.current) videoRef.current.currentTime -= 5; }}
                            className="p-2 hover:bg-[#222] rounded-full text-white"
                            title="Rewind 5s"
                        >
                            <RotateCcw className="w-5 h-5" />
                        </button>
                        <button 
                            onClick={togglePlay}
                            className="p-3 bg-white text-black rounded-full hover:bg-gray-200 transition-colors"
                        >
                            {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
                        </button>
                        <button 
                            onClick={() => { if(videoRef.current) videoRef.current.currentTime += 5; }}
                            className="p-2 hover:bg-[#222] rounded-full text-white"
                            title="Forward 5s"
                        >
                            <RotateCw className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="w-[1px] h-8 bg-[#333]" />

                    {/* Volume Control */}
                    <div className="flex items-center gap-2 group relative w-28">
                        <button onClick={toggleMute} className="p-2 hover:bg-[#222] rounded-full text-gray-300">
                            {isMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                        </button>
                        <div className="flex-1">
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.05"
                                value={isMuted ? 0 : volume}
                                onChange={(e) => {
                                    setVolume(parseFloat(e.target.value));
                                    if (isMuted && parseFloat(e.target.value) > 0) setIsMuted(false);
                                }}
                                className="w-full h-1 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-400 group-hover:[&::-webkit-slider-thumb]:bg-blue-500"
                            />
                        </div>
                    </div>

                    <div className="w-[1px] h-8 bg-[#333]" />

                    {/* Timeline with Events inside */}
                    <div className="flex-1 flex flex-col justify-center relative group/timeline h-12" ref={timelineRef}>
                        {/* Live Recording Overlay */}
                        {isTaggingMode && activeRecording && (
                            <div 
                                style={{
                                    left: `${(activeRecording.startTime / (duration || 1)) * 100}%`,
                                    width: `${((currentTime - activeRecording.startTime) / (duration || 1)) * 100}%`,
                                    backgroundColor: tags.find(t => t.id === activeRecording.tagId)?.color || 'red'
                                }}
                                className="absolute top-1/2 -translate-y-1/2 h-8 opacity-30 z-0 pointer-events-none animate-pulse rounded"
                            />
                        )}

                        {/* Background Track */}
                        <div className="absolute top-1/2 -translate-y-1/2 left-0 w-full h-8 bg-[#1a1a1a] rounded overflow-hidden">
                            {/* Progress Fill */}
                            <div 
                                className="h-full bg-gray-800 opacity-40 pointer-events-none" 
                                style={{ width: `${(currentTime / (duration || 1)) * 100}%` }}
                            />
                        </div>

                        {/* Playhead Indicator (Red Needle) */}
                        <div 
                            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-50 pointer-events-none shadow-[0_0_10px_rgba(239,68,68,0.8)]"
                            style={{ left: `${(currentTime / (duration || 1)) * 100}%` }}
                        >
                            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-red-500 rounded-full" />
                        </div>

                        {/* Events Layer - INSIDE BAR */}
                        <div className="absolute top-1/2 -translate-y-1/2 left-0 w-full h-8 pointer-events-none z-10">
                            {tagEvents.filter(e => filterTagId ? e.tagId === filterTagId : true).map(evt => {
                                const tag = tags.find(t => t.id === evt.tagId);
                                const startPct = (evt.startTime / (duration || 1)) * 100;
                                const widthPct = ((evt.endTime - evt.startTime) / (duration || 1)) * 100;
                                const isSelected = selectedEventIds.has(evt.id);

                                return (
                                    <div
                                        key={evt.id}
                                        style={{ 
                                            left: `${startPct}%`,
                                            width: `${Math.max(widthPct, 0.4)}%`,
                                            backgroundColor: tag?.color || '#fff'
                                        }}
                                        className={`absolute top-0 bottom-0 cursor-pointer pointer-events-auto transition-all group/tagevent
                                            ${isSelected ? 'ring-2 ring-white z-30 opacity-100' : 'opacity-80 hover:opacity-100 z-20'}
                                        `}
                                        onClick={(e) => handleEventClick(e, evt.id, evt.startTime)}
                                        onContextMenu={(e) => handleEventContextMenu(e, evt.id)}
                                    >
                                        {/* Tooltip */}
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-black/90 text-white text-[9px] rounded whitespace-nowrap opacity-0 group-hover/tagevent:opacity-100 pointer-events-none transition-opacity border border-[#333]">
                                            {tag?.name} ({ (evt.endTime - evt.startTime).toFixed(1) }s)
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        
                        {/* Markers */}
                        <div className="absolute top-1/2 -translate-y-1/2 left-0 w-full h-8 pointer-events-none z-40">
                            {markers.map(marker => (
                                <div 
                                    key={marker.id}
                                    style={{ 
                                        left: `${(marker.time / (duration || 1)) * 100}%`,
                                        backgroundColor: marker.color
                                    }}
                                    className="absolute top-0 bottom-0 w-0.5 pointer-events-auto hover:w-1 transition-all cursor-pointer group/marker"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        jumpToMarker(marker.time);
                                    }}
                                    onContextMenu={(e) => handleMarkerContextMenu(e, marker)}
                                >
                                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full" style={{backgroundColor: marker.color}} />
                                    {/* Hover Tooltip */}
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-black/90 text-white text-[10px] rounded whitespace-nowrap opacity-0 group-hover/marker:opacity-100 pointer-events-none transition-opacity shadow-lg border border-[#333]">
                                        {marker.label}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <input 
                            type="range"
                            min="0"
                            max={duration || 100}
                            step="0.01"
                            value={currentTime}
                            onChange={handleSeek}
                            onContextMenu={handleTimelineContextMenu}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-0"
                        />
                        <div className="absolute -bottom-4 left-0 right-0 flex justify-between text-[10px] text-gray-400 font-mono pointer-events-none">
                            <span>{new Date(currentTime * 1000).toISOString().substr(14, 5)}</span>
                            <span>{new Date((duration || 0) * 1000).toISOString().substr(14, 5)}</span>
                        </div>
                    </div>
                    
                    <div className="w-[1px] h-8 bg-[#333]" />
                    
                    {/* Speed Slider */}
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-medium w-8 text-center text-gray-400">Speed</span>
                        <input 
                            type="range"
                            min="0.1"
                            max="4.0"
                            step="0.1"
                            value={playbackRate}
                            onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
                            className="w-20 h-1.5 bg-[#333] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gray-400 hover:[&::-webkit-slider-thumb]:bg-white"
                        />
                        <span className="text-xs font-mono w-8">{playbackRate.toFixed(1)}x</span>
                    </div>
                </div>
            </div>

            {/* Slides Iframe Layer - Matches exact size of canvas area via parent flex */}
            <div 
                className="flex-1 flex flex-col bg-white"
                style={{ display: viewMode === 'slides' ? 'flex' : 'none' }}
            >
                {slideUrl ? (
                    <iframe 
                        src={slideUrl} 
                        className="flex-1 w-full border-0" 
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-4">
                        <Presentation className="w-16 h-16 text-gray-300" />
                        <p>Enter a URL above to load slides</p>
                    </div>
                )}
            </div>
        </div>

        {/* --- RIGHT SIDEBAR: Tagging & Playlist --- */}
        <div style={{ width: rightPanelWidth }} className="flex flex-col bg-[#111] border-l border-[#222] z-30 shrink-0 relative">
             {/* Resize Handle (Width) */}
             <div
                className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 transition-colors z-50"
                onMouseDown={startResizeWidth}
             />

             {/* Tagging Header */}
             <div className="p-4 border-b border-[#222] flex items-center justify-between shrink-0">
                 <div className="flex items-center gap-2">
                     <Tags className="w-4 h-4 text-blue-400" />
                     <h3 className="text-sm font-semibold text-white">Event Tagging</h3>
                 </div>
                 <div className="flex items-center gap-2">
                     <span className={`text-[10px] font-bold uppercase tracking-wider ${isTaggingMode ? 'text-red-500 animate-pulse' : 'text-gray-500'}`}>
                         {isTaggingMode ? 'REC' : 'OFF'}
                     </span>
                     <button 
                        onClick={() => {
                            setIsTaggingMode(!isTaggingMode);
                            setActiveRecording(null); 
                        }}
                        className={`w-10 h-5 rounded-full relative transition-colors ${
                            isTaggingMode ? 'bg-red-500' : 'bg-gray-700'
                        }`}
                     >
                        <motion.div 
                            className="w-3 h-3 bg-white rounded-full absolute top-1"
                            animate={{ left: isTaggingMode ? 'calc(100% - 16px)' : '4px' }}
                        />
                     </button>
                     <button className="p-1 text-gray-400 hover:text-white" onClick={() => setTagSettingsOpen(true)}>
                         <Settings2 className="w-4 h-4" />
                     </button>
                 </div>
             </div>

             {/* Tags Grid (Resizable Area) */}
             <div style={{ height: tagsSectionHeight }} className="overflow-y-auto border-b border-[#222] shrink-0">
                <div className="p-4 grid gap-2 grid-cols-[repeat(auto-fill,minmax(110px,1fr))]">
                    {tags.map(tag => {
                        const isActive = activeRecording?.tagId === tag.id;
                        const count = tagEvents.filter(e => e.tagId === tag.id).length;
                        const isFiltered = filterTagId === tag.id;

                        return (
                            <button
                                key={tag.id}
                                onClick={() => handleTagClick(tag.id)}
                                className={`
                                    relative h-12 rounded-lg border flex items-center justify-between px-3 transition-all overflow-hidden group
                                    ${isTaggingMode 
                                        ? (isActive ? 'border-transparent bg-gray-800 scale-95 ring-2' : 'border-[#333] bg-[#161616] hover:bg-[#222]') 
                                        : (isFiltered ? 'border-transparent bg-[#222] ring-1 ring-white' : 'border-[#333] bg-[#161616] hover:bg-[#222]')
                                    }
                                `}
                                style={{ 
                                    borderColor: (isActive || isFiltered) ? tag.color : undefined,
                                    boxShadow: isActive ? `0 0 15px ${fadeColor(tag.color, 0.2)}` : undefined
                                }}
                            >
                                {/* Color indicator bar */}
                                <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: tag.color }} />
                                
                                <span className="text-xs font-medium text-gray-200 truncate">{tag.name}</span>
                                
                                <div className="flex items-center gap-2">
                                    {/* Hotkey Badge */}
                                    <div className="flex items-center justify-center w-5 h-5 bg-[#333] rounded text-[10px] font-bold text-gray-400 group-hover:text-white border border-[#444]">
                                        {tag.shortcut}
                                    </div>
                                    {!isTaggingMode && (
                                        <span className="text-[10px] text-gray-600 font-mono">{count}</span>
                                    )}
                                </div>

                                {isActive && (
                                    <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                )}
                            </button>
                        );
                    })}
                </div>
             </div>
             
             {/* Resize Handle (Height) */}
             <div 
                className="h-1 bg-[#222] hover:bg-blue-500 cursor-row-resize shrink-0 transition-colors z-40"
                onMouseDown={startResizeHeight}
             />

             {/* Playlists Header */}
             <div className="p-4 border-b border-[#222] flex items-center justify-between shrink-0">
                 <div className="flex items-center gap-2">
                     <ListPlus className="w-4 h-4 text-emerald-400" />
                     <h3 className="text-sm font-semibold text-white">Playlists</h3>
                 </div>
                 <div className="flex items-center gap-1">
                     <label className="p-1 text-gray-400 hover:text-white cursor-pointer" title="Import XML">
                         <FileUp className="w-4 h-4" />
                         <input type="file" accept=".xml" className="hidden" onChange={importXML} />
                     </label>
                     <button onClick={exportXML} className="p-1 text-gray-400 hover:text-white" title="Export XML">
                         <FileDown className="w-4 h-4" />
                     </button>
                     <button 
                        onClick={() => setPlaylistModal({ isOpen: true, mode: 'create', tempName: '' })}
                        className="p-1 text-gray-400 hover:text-white" 
                        title="New Playlist"
                     >
                         <FolderPlus className="w-4 h-4" />
                     </button>
                 </div>
             </div>

             {/* Folders List */}
             <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
                 {/* Folders */}
                 <div className="px-2 pt-2 pb-2 space-y-1 shrink-0 max-h-[150px] overflow-y-auto">
                     {playlists.map(pl => (
                         <div key={pl.id} className="group relative">
                             <button
                                onClick={() => setActivePlaylistId(pl.id)}
                                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors pr-8 ${
                                    activePlaylistId === pl.id ? 'bg-[#222] text-white' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1a1a]'
                                }`}
                             >
                                 <Folder className={`w-4 h-4 ${activePlaylistId === pl.id ? 'text-blue-400 fill-blue-400/20' : ''}`} />
                                 <span className="flex-1 text-left truncate">{pl.name}</span>
                                 <span className="text-xs text-gray-600">{pl.events.length}</span>
                             </button>
                             {/* Playlist Actions on Hover */}
                             <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-[#222] rounded p-0.5">
                                 <button 
                                     onClick={(e) => {
                                         e.stopPropagation();
                                         setPlaylistModal({ isOpen: true, mode: 'edit', playlistId: pl.id, tempName: pl.name });
                                     }}
                                     className="p-1 hover:bg-[#333] rounded text-gray-400 hover:text-white"
                                     title="Rename"
                                 >
                                     <Pencil className="w-3 h-3" />
                                 </button>
                                 <button 
                                     onClick={(e) => {
                                         e.stopPropagation();
                                         setPlaylistDeleteId(pl.id);
                                     }}
                                     className="p-1 hover:bg-red-900/30 rounded text-gray-400 hover:text-red-400"
                                     title="Delete"
                                 >
                                     <Trash className="w-3 h-3" />
                                 </button>
                             </div>
                         </div>
                     ))}
                 </div>

                 {/* Active Playlist Items Header */}
                 <div className="border-t border-[#222] p-2 bg-[#141414] shrink-0 flex items-center justify-between">
                     <div className="flex items-center gap-2 overflow-hidden">
                        <Folder className="w-3 h-3 text-blue-500" />
                        <h4 className="text-[11px] font-bold text-gray-300 truncate max-w-[120px]">
                            {playlists.find(p => p.id === activePlaylistId)?.name}
                        </h4>
                     </div>
                     <div className="flex items-center gap-1">
                         {/* Autoplay Button */}
                         {autoplay.active && autoplay.playlistId === activePlaylistId ? (
                             <button
                                onClick={() => setAutoplay({ active: false, playlistId: null, eventIndex: -1 })}
                                className="flex items-center gap-1 px-2 py-1 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded text-[10px] font-bold"
                             >
                                 <StopCircle className="w-3 h-3" />
                                 Stop
                             </button>
                         ) : (
                             <button 
                                onClick={() => startPlaylistAutoplay(activePlaylistId)}
                                disabled={!playlists.find(p => p.id === activePlaylistId)?.events.length}
                                className="flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded text-[10px] font-bold disabled:opacity-50"
                             >
                                 <PlayCircle className="w-3 h-3" />
                                 Play All
                             </button>
                         )}
                     </div>
                 </div>

                 {/* Active Playlist Items List */}
                 <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-[#0a0a0a]">
                     {playlists.find(p => p.id === activePlaylistId)?.events.map((evt, i) => {
                         const tag = tags.find(t => t.id === evt.tagId);
                         const isPlayingEvent = autoplay.active && autoplay.playlistId === activePlaylistId && autoplay.eventIndex === i;
                         
                         return (
                             <div 
                                key={i} 
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData('text/plain', i.toString());
                                    e.dataTransfer.effectAllowed = 'move';
                                    setDraggingEventIndex(i);
                                }}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'move';
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
                                    if (fromIndex !== i) {
                                        reorderPlaylistEvents(activePlaylistId, fromIndex, i);
                                    }
                                    setDraggingEventIndex(null);
                                }}
                                className={`flex flex-col gap-1 p-2 rounded border border-transparent group transition-all
                                    ${isPlayingEvent 
                                        ? 'bg-[#1a1a1a] border-blue-500/50' 
                                        : 'bg-[#161616] hover:bg-[#222] hover:border-[#333]'
                                    }
                                    ${draggingEventIndex === i ? 'opacity-50 dashed border-gray-500' : ''}
                                `}
                             >
                                 <div className="flex items-center gap-2">
                                    <div className="cursor-grab text-gray-600 hover:text-gray-400">
                                        <GripVertical className="w-3 h-3" />
                                    </div>
                                    <div className="w-1 h-3 rounded-full shrink-0" style={{ backgroundColor: tag?.color }} />
                                    <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-gray-300 truncate">{tag?.name}</div>
                                    </div>
                                    <div className="text-[10px] text-gray-500 font-mono">
                                         {new Date(evt.startTime * 1000).toISOString().substr(14, 5)}
                                    </div>
                                     {/* Item Actions */}
                                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                            onClick={() => jumpToMarker(evt.startTime)} 
                                            className="p-1.5 text-gray-400 hover:text-white"
                                            title="Play Clip"
                                        >
                                            <Play className="w-3 h-3" />
                                        </button>
                                        <button
                                            onClick={() => removeEventFromPlaylist(activePlaylistId, i)}
                                            className="p-1.5 text-gray-400 hover:text-red-400"
                                            title="Remove from Playlist"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </div>
                                 </div>
                                 {/* Notes Display */}
                                 {evt.notes && (
                                     <div className="flex items-start gap-1 text-[10px] text-gray-400 pl-6 border-l-2 border-[#333] ml-1">
                                         <MessageSquare className="w-2.5 h-2.5 mt-0.5 shrink-0" />
                                         <span className="italic line-clamp-2">{evt.notes}</span>
                                     </div>
                                 )}
                             </div>
                         );
                     })}
                     {playlists.find(p => p.id === activePlaylistId)?.events.length === 0 && (
                         <div className="flex flex-col items-center justify-center h-20 text-gray-600 space-y-1">
                             <ListPlus className="w-6 h-6 opacity-20" />
                             <span className="text-xs italic">List is empty</span>
                         </div>
                     )}
                 </div>
             </div>

             {/* Playlist Bottom Actions */}
             <div className="p-3 border-t border-[#222] flex gap-2 shrink-0 bg-[#111]">
                 <button 
                    id="save-playlist-btn"
                    onClick={addSelectedToPlaylist}
                    className="flex-1 bg-[#222] hover:bg-[#333] text-white text-xs font-bold py-2 rounded flex items-center justify-center gap-2 transition-colors border border-[#333]"
                 >
                     <Save className="w-3 h-3" />
                     Add Selection (Ctrl+S)
                 </button>
             </div>
        </div>
      </div>
      
       {/* Tag Settings Modal (CRUD) */}
       <AnimatePresence>
         {tagSettingsOpen && (
             <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                 <motion.div 
                     initial={{ scale: 0.95, opacity: 0 }}
                     animate={{ scale: 1, opacity: 1 }}
                     exit={{ scale: 0.95, opacity: 0 }}
                     className="bg-[#1a1a1a] border border-[#333] rounded-xl w-[500px] shadow-2xl flex flex-col max-h-[80vh]"
                 >
                     <div className="p-4 border-b border-[#333] flex items-center justify-between">
                         <div className="flex items-center gap-2">
                             <h3 className="font-semibold text-white">Manage Tags</h3>
                             {/* Tag Preset Actions */}
                             <div className="flex gap-1 ml-4">
                                <label className="p-1 bg-[#222] rounded hover:bg-[#333] cursor-pointer" title="Import Presets">
                                    <FileUp className="w-4 h-4 text-gray-400 hover:text-white" />
                                    <input type="file" accept=".json" className="hidden" onChange={handleImportTags} />
                                </label>
                                <button onClick={handleExportTags} className="p-1 bg-[#222] rounded hover:bg-[#333]" title="Export Presets">
                                    <FileDown className="w-4 h-4 text-gray-400 hover:text-white" />
                                </button>
                             </div>
                         </div>
                         <button onClick={() => setTagSettingsOpen(false)} className="text-gray-400 hover:text-white">
                             <X className="w-5 h-5" />
                         </button>
                     </div>
                     <div className="p-4 overflow-y-auto flex-1 space-y-2">
                         {tags.map(tag => (
                             <div key={tag.id} className="flex items-center gap-2 p-2 bg-[#111] border border-[#333] rounded-lg">
                                 {editingTagId === tag.id ? (
                                     <>
                                         <input 
                                             type="color" 
                                             value={tempTag.color || tag.color} 
                                             onChange={e => setTempTag({...tempTag, color: e.target.value})}
                                             className="w-8 h-8 rounded cursor-pointer bg-transparent"
                                         />
                                         <input 
                                             type="text" 
                                             value={tempTag.name !== undefined ? tempTag.name : tag.name} 
                                             onChange={e => setTempTag({...tempTag, name: e.target.value})}
                                             className="flex-1 bg-[#222] border border-[#444] rounded px-2 py-1 text-sm text-white"
                                         />
                                         <input 
                                             type="text" 
                                             maxLength={1}
                                             value={tempTag.shortcut !== undefined ? tempTag.shortcut : tag.shortcut} 
                                             onChange={e => setTempTag({...tempTag, shortcut: e.target.value.toUpperCase()})}
                                             className="w-10 bg-[#222] border border-[#444] rounded px-2 py-1 text-sm text-center text-white"
                                         />
                                         <button 
                                             onClick={() => {
                                                 setTags(prev => prev.map(t => t.id === tag.id ? { ...t, ...tempTag } as Tag : t));
                                                 setEditingTagId(null);
                                                 setTempTag({});
                                             }}
                                             className="p-1.5 bg-green-900/30 text-green-400 rounded hover:bg-green-900/50"
                                         >
                                             <Check className="w-4 h-4" />
                                         </button>
                                     </>
                                 ) : (
                                     <>
                                         <div className="w-8 h-8 rounded" style={{backgroundColor: tag.color}} />
                                         <span className="flex-1 text-sm text-gray-200">{tag.name}</span>
                                         <span className="w-8 text-center text-xs font-mono text-gray-500 bg-[#222] rounded px-1">{tag.shortcut}</span>
                                         <button 
                                             onClick={() => {
                                                 setEditingTagId(tag.id);
                                                 setTempTag({ name: tag.name, color: tag.color, shortcut: tag.shortcut });
                                             }}
                                             className="p-1.5 text-gray-400 hover:text-white hover:bg-[#222] rounded"
                                         >
                                             <Edit2 className="w-4 h-4" />
                                         </button>
                                         <button 
                                             type="button"
                                             onClick={(e) => {
                                                e.stopPropagation();
                                                if (window.confirm('Delete this tag?')) {
                                                    setTags(prev => prev.filter(t => t.id !== tag.id));
                                                }
                                             }}
                                             className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-red-900/20 rounded"
                                         >
                                             <Trash2 className="w-4 h-4" />
                                         </button>
                                     </>
                                 )}
                             </div>
                         ))}
                         {/* Add New Tag Row */}
                         {!editingTagId && (
                             <button 
                                 onClick={() => {
                                     const newId = Date.now().toString();
                                     setTags(prev => [...prev, { id: newId, name: 'New Tag', color: '#ffffff', shortcut: '?' }]);
                                     setEditingTagId(newId);
                                     setTempTag({ name: 'New Tag', color: '#ffffff', shortcut: '?' });
                                 }}
                                 className="w-full py-2 border border-dashed border-[#444] rounded-lg text-gray-500 hover:text-white hover:border-gray-300 flex items-center justify-center gap-2 text-sm"
                             >
                                 <Plus className="w-4 h-4" />
                                 Add New Tag
                             </button>
                         )}
                     </div>
                 </motion.div>
             </div>
         )}
       </AnimatePresence>

       {/* Playlist Modal */}
       <AnimatePresence>
        {playlistModal && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                 <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    className="bg-[#1a1a1a] border border-[#333] p-6 rounded-xl w-80 shadow-2xl flex flex-col gap-4"
                 >
                    <div className="flex items-center justify-between pb-2 border-b border-[#333]">
                        <h4 className="text-sm font-semibold text-white">
                            {playlistModal.mode === 'create' ? 'Create Playlist' : 'Rename Playlist'}
                        </h4>
                        <button onClick={() => setPlaylistModal(null)} className="text-gray-500 hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] text-gray-400 uppercase font-semibold">Name</label>
                        <input 
                            type="text" 
                            autoFocus
                            placeholder="Playlist Name..."
                            value={playlistModal.tempName}
                            onChange={(e) => setPlaylistModal({...playlistModal, tempName: e.target.value})}
                            onKeyDown={(e) => e.key === 'Enter' && savePlaylist()}
                            className="w-full bg-[#111] border border-[#333] rounded px-2 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <div className="flex gap-2 pt-2">
                        <button 
                            onClick={savePlaylist}
                            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
                        >
                            Save
                        </button>
                    </div>
                 </motion.div>
            </div>
        )}
       </AnimatePresence>

       {/* Playlist Delete Warning Modal */}
        <AnimatePresence>
            {playlistDeleteId && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <motion.div 
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="bg-[#1a1a1a] border border-[#333] p-6 rounded-xl w-80 shadow-2xl text-center"
                    >
                        <div className="flex justify-center mb-4 text-red-500">
                            <AlertTriangle className="w-8 h-8" />
                        </div>
                        <h3 className="font-semibold text-white mb-2">Delete Playlist?</h3>
                        <p className="text-sm text-gray-400 mb-6">Are you sure you want to delete this playlist? All events in this list will be removed (original tags remain).</p>
                        <div className="flex gap-3 justify-center">
                            <button 
                                onClick={() => setPlaylistDeleteId(null)}
                                className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-[#222] rounded-lg"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={confirmDeletePlaylist}
                                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
                            >
                                Delete
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>

       {/* Event Context Menu */}
       {contextMenu && (
           <div 
               className="fixed z-[70] bg-[#1a1a1a] border border-[#333] rounded shadow-xl py-1 w-32"
               style={{ left: contextMenu.x, top: contextMenu.y }}
           >
               <button 
                   onClick={handleEditEvent}
                   className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-[#333] hover:text-white flex items-center gap-2"
               >
                   <Edit2 className="w-3 h-3" />
                   Edit Event
               </button>
               <button 
                   onClick={handleDeleteEventRequest}
                   className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300 flex items-center gap-2"
               >
                   <Trash className="w-3 h-3" />
                   Delete Event
               </button>
           </div>
       )}
       {/* Close context menu on click elsewhere */}
       {contextMenu && (
           <div className="fixed inset-0 z-[65] bg-transparent" onClick={() => setContextMenu(null)} />
       )}

       {/* Edit Event Modal (Trimming & Notes) */}
       <AnimatePresence>
            {editEventModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <motion.div 
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="bg-[#1a1a1a] border border-[#333] p-5 rounded-xl w-80 shadow-2xl flex flex-col gap-4"
                    >
                        <div className="flex items-center justify-between pb-2 border-b border-[#333]">
                            <h4 className="text-sm font-semibold text-white">Edit Event</h4>
                            <button onClick={() => setEditEventModal(null)} className="text-gray-500 hover:text-white">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <label className="text-[10px] text-gray-400 uppercase font-semibold">Start Time</label>
                                    <button 
                                        onClick={() => setEditEventModal(prev => prev ? {...prev, startTime: currentTime} : null)}
                                        className="text-[10px] text-blue-400 hover:text-blue-300"
                                    >
                                        Set to Current
                                    </button>
                                </div>
                                <input 
                                    type="number" 
                                    step="0.1"
                                    value={editEventModal.startTime}
                                    onChange={(e) => setEditEventModal({...editEventModal, startTime: parseFloat(e.target.value)})}
                                    className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <div className="space-y-1">
                                <div className="flex justify-between">
                                    <label className="text-[10px] text-gray-400 uppercase font-semibold">End Time</label>
                                    <button 
                                        onClick={() => setEditEventModal(prev => prev ? {...prev, endTime: currentTime} : null)}
                                        className="text-[10px] text-blue-400 hover:text-blue-300"
                                    >
                                        Set to Current
                                    </button>
                                </div>
                                <input 
                                    type="number" 
                                    step="0.1"
                                    value={editEventModal.endTime}
                                    onChange={(e) => setEditEventModal({...editEventModal, endTime: parseFloat(e.target.value)})}
                                    className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                                />
                            </div>

                            <div className="space-y-1">
                                <label className="text-[10px] text-gray-400 uppercase font-semibold">Notes</label>
                                <textarea 
                                    value={editEventModal.notes}
                                    onChange={(e) => setEditEventModal({...editEventModal, notes: e.target.value})}
                                    placeholder="Add tactical notes..."
                                    className="w-full bg-[#111] border border-[#333] rounded px-2 py-2 text-sm text-white focus:outline-none focus:border-blue-500 min-h-[60px]"
                                />
                            </div>
                        </div>

                        <div className="flex gap-2 pt-2 border-t border-[#333]">
                             <button 
                                onClick={handleDeleteEventRequest}
                                className="px-3 py-2 bg-red-900/20 text-red-400 hover:bg-red-900/40 rounded text-xs font-medium transition-colors"
                            >
                                Delete
                            </button>
                            <button 
                                onClick={saveEditedEvent}
                                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
                            >
                                Save Changes
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
       </AnimatePresence>

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
            {deleteConfirmation && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <motion.div 
                        initial={{ scale: 0.95, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.95, opacity: 0 }}
                        className="bg-[#1a1a1a] border border-[#333] p-6 rounded-xl w-80 shadow-2xl text-center"
                    >
                        <div className="flex justify-center mb-4 text-red-500">
                            <AlertTriangle className="w-8 h-8" />
                        </div>
                        <h3 className="font-semibold text-white mb-2">Delete Event?</h3>
                        <p className="text-sm text-gray-400 mb-6">Are you sure you want to delete this event? This action cannot be undone.</p>
                        <div className="flex gap-3 justify-center">
                            <button 
                                onClick={() => setDeleteConfirmation(null)}
                                className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-[#222] rounded-lg"
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={confirmDeleteEvent}
                                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
                            >
                                Delete
                            </button>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>

       {/* Marker Edit/Create Modal */}
       <AnimatePresence>
        {markerModal && (
            <div className="fixed inset-0 z-[60] pointer-events-none">
                 <div 
                    className="absolute inset-0 pointer-events-auto"
                    onMouseDown={() => setMarkerModal(null)} 
                 />
                 <motion.div 
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    style={{ left: markerModal.x, top: markerModal.y }}
                    className="absolute bg-[#1a1a1a] border border-[#333] p-4 rounded-xl w-64 shadow-2xl origin-bottom-left pointer-events-auto flex flex-col gap-3"
                 >
                    <div className="flex items-center justify-between pb-2 border-b border-[#333]">
                        <h4 className="text-sm font-semibold text-white">
                            {markerModal.mode === 'create' ? 'Add Marker' : 'Edit Marker'}
                        </h4>
                        <button onClick={() => setMarkerModal(null)} className="text-gray-500 hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] text-gray-400 uppercase font-semibold">Label</label>
                        <input 
                            type="text" 
                            autoFocus
                            placeholder="Tactical Note..."
                            value={markerModal.tempLabel}
                            onChange={(e) => setMarkerModal({...markerModal, tempLabel: e.target.value})}
                            onKeyDown={(e) => e.key === 'Enter' && saveMarker()}
                            className="w-full bg-[#111] border border-[#333] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
                        />
                    </div>
                    <div className="space-y-1">
                        <label className="text-[10px] text-gray-400 uppercase font-semibold">Color</label>
                        <div className="flex gap-2">
                             {['#ef4444', '#eab308', '#3b82f6', '#22c55e', '#a855f7', '#ffffff'].map(c => (
                                 <button 
                                    key={c}
                                    onClick={() => setMarkerModal({...markerModal, tempColor: c})}
                                    className={`w-6 h-6 rounded-full border-2 transition-transform ${
                                        markerModal.tempColor === c ? 'border-white scale-110' : 'border-transparent ring-1 ring-white/10'
                                    }`}
                                    style={{ backgroundColor: c }}
                                 />
                             ))}
                        </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                        {markerModal.mode === 'edit' && (
                            <button 
                                onClick={deleteMarker}
                                className="flex-1 py-1.5 bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded text-xs font-medium transition-colors"
                            >
                                Delete
                            </button>
                        )}
                        <button 
                            onClick={saveMarker}
                            className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
                        >
                            Save
                        </button>
                    </div>
                 </motion.div>
            </div>
        )}
       </AnimatePresence>

       {/* Confirm Close Modal */}
       <AnimatePresence>
        {showCloseConfirm && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
             <motion.div 
               initial={{ scale: 0.95, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               exit={{ scale: 0.95, opacity: 0 }}
               className="bg-[#1a1a1a] border border-[#333] p-6 rounded-xl w-80 shadow-2xl"
             >
                <div className="flex items-center gap-3 text-amber-500 mb-4">
                  <AlertTriangle className="w-6 h-6" />
                  <h3 className="font-semibold text-white">End Session?</h3>
                </div>
                <p className="text-gray-400 text-sm mb-6">
                  All drawings and annotations will be lost. This action cannot be undone.
                </p>
                <div className="flex gap-3 justify-end">
                  <button 
                    onClick={() => setShowCloseConfirm(false)}
                    className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-[#222] rounded-lg"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={confirmClose}
                    className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium"
                  >
                    Close File
                  </button>
                </div>
             </motion.div>
          </div>
        )}
       </AnimatePresence>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);