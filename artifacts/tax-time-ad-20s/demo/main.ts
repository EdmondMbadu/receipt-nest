import { Component, signal, provideZonelessChangeDetection } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideRouter, RouterOutlet } from '@angular/router';
import { AiInsightsComponent } from '../../../src/app/features/ai-insights/ai-insights.component';
import { ReceiptDetailComponent } from '../../../src/app/features/receipt-detail/receipt-detail.component';
import { FolderDetailComponent } from '../../../src/app/features/folders/folder-detail.component';
import { AuthService } from '../../../src/app/services/auth.service';
import { ThemeService } from '../../../src/app/services/theme.service';
import { ReceiptService } from '../../../src/app/services/receipt.service';
import { AiInsightsService } from '../../../src/app/services/ai-insights.service';
import { FolderService } from '../../../src/app/services/folder.service';
import { PdfThumbnailService } from '../../../src/app/services/pdf-thumbnail.service';
import { ReceiptTourService } from '../../../src/app/services/receipt-tour.service';
// Production UI components with local sample fixtures, without Firebase providers.
const amounts=[32.40,18.60,47.80,26.20,54,22.40,38.50,46.50];
const merchants=['Oak Street Cafe','Corner Kitchen','Market Table','Oak Street Cafe','Juniper Kitchen','Corner Kitchen','Market Table','Juniper Kitchen'];
const receipts:any[]=amounts.map((totalAmount,i)=>({id:'food-'+i,userId:'demo',status:'final',source:'upload',createdAt:new Date(2026,10,i*3+1),updatedAt:new Date(2026,10,i*3+1),date:`2026-11-${String(i*3+1).padStart(2,'0')}`,totalAmount,currency:'USD',merchant:{canonicalName:merchants[i],rawName:merchants[i],matchConfidence:.98,matchedBy:'ai'},category:{id:'restaurants',name:'Restaurants & Dining',confidence:.98,assignedBy:'ai'},file:{storagePath:`food-${i}.svg`,originalName:'food-receipt.jpg',mimeType:'image/jpeg',size:12000},extraction:{supplierName:{value:merchants[i],confidence:.98},totalAmount:{value:totalAmount,confidence:.98},date:{value:`2026-11-${String(i*3+1).padStart(2,'0')}`,confidence:.98}},notes:''}));
const earlier:any[]=[0,1,2].map(i=>({...receipts[i],id:'earlier-'+i,date:`2026-0${i+2}-12`,createdAt:new Date(2026,i+1,12)}));
const office={...receipts[0],id:'office',totalAmount:998.20,merchant:{canonicalName:'Studio Supply'},category:{id:'shopping',name:'Shopping',assignedBy:'ai'},file:{...receipts[0].file,storagePath:'office.svg'}};
const all=[...receipts,office,...earlier];
const receiptService:any={receipts:signal(all),isLoading:signal(false),selectedMonthLabel:signal('November 2026'),selectedMonthSpend:signal(1284.60),selectedMonthReceipts:signal([...receipts,office]),isCurrentMonth:signal(true),subscribeToReceipts(){},unsubscribeFromReceipts(){},getReceipt:async(id:string)=>all.find(r=>r.id===id),getReceiptFileUrl:async(path:string)=>'/assets/'+path,getEffectiveAmount:(r:any)=>r.totalAmount,goToPreviousMonth(){},goToNextMonth(){},goToCurrentMonth(){}};
const messages=signal<any[]>([]);
const ai:any={messages,isLoading:signal(false),error:signal(null),isUploading:signal(false),uploadProgress:signal(0),chatThumbnails:new Map(),getSuggestedQuestions:()=>['How much did I spend on food this month?'],initializeChatState:async()=>{},startNewChat:()=>messages.set([]),sendMessage:async(text:string)=>{messages.set([{id:'q',role:'user',content:text,timestamp:new Date()}]);ai.isLoading.set(true);setTimeout(()=>{messages.update(v=>[...v,{id:'a',role:'assistant',content:'You spent **$286.40** on **food** in November.\n\nBased on **8 saved receipts** this month.',timestamp:new Date()}]);ai.isLoading.set(false)},650)}};
const folders:any={folders:signal([{id:'year-2026',name:'2026 business receipts',receiptIds:all.map(r=>r.id),createdAt:new Date(),updatedAt:new Date()}]),isLoading:signal(false),error:signal(null),subscribeToFolders(){},unsubscribeFromFolders(){}};
const tour:any={active:signal(false),preview:signal(false),previewEnabled:signal(false),cameraActive:signal(false),mode:signal('hidden'),step:signal('details'),receiptLoaded(){},receiptOpened(){}};
@Component({selector:'ad-demo',standalone:true,imports:[RouterOutlet],template:'<router-outlet />'}) class Demo {}
bootstrapApplication(Demo,{providers:[provideZonelessChangeDetection(),provideRouter([{path:'ai',component:AiInsightsComponent},{path:'receipt/:id',component:ReceiptDetailComponent},{path:'folder/:id',component:FolderDetailComponent},{path:'',redirectTo:'ai',pathMatch:'full'}]),{provide:AuthService,useValue:{user:signal({id:'demo',displayName:'Alex',role:'admin',subscriptionPlan:'pro',subscriptionStatus:'active'})}},{provide:ThemeService,useValue:{isDarkMode:signal(false),toggleTheme(){}}},{provide:ReceiptService,useValue:receiptService},{provide:AiInsightsService,useValue:ai},{provide:FolderService,useValue:folders},{provide:ReceiptTourService,useValue:tour},{provide:PdfThumbnailService,useValue:{}}]}).catch(console.error);
