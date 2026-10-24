-- Fox Launcher 1.7: subscription duration options. Apply AFTER migrate-1.6.sql.
-- Existing 30-day products stay unchanged; new options use the same tier and extend/replace subscriptions via the existing RPC.
begin;
insert into public.fox_catalog
  (id,title,description,kind,price,currency,tier,days,event_only,reward_currency,reward_amount,enabled,discount_percent,price_kopeks)
values
 ('plus-2m','Fox Plus · 2 месяца','Редактор скинов и значок Plus. Подписка на 2 месяца.', 'subscription',200,'foxes',1,60,false,null,0,true,0,0),
 ('plus-3m','Fox Plus · 3 месяца','Редактор скинов и значок Plus. Подписка на 3 месяца.', 'subscription',300,'foxes',1,90,false,null,0,true,0,0),
 ('plus-6m','Fox Plus · 6 месяцев','Редактор скинов и значок Plus. Подписка на 6 месяцев.', 'subscription',600,'foxes',1,180,false,null,0,true,0,0),
 ('plus-12m','Fox Plus · 12 месяцев','Редактор скинов и значок Plus. Подписка на 12 месяцев.', 'subscription',1200,'foxes',1,360,false,null,0,true,0,0),
 ('plus-24m','Fox Plus · 24 месяца','Редактор скинов и значок Plus. Подписка на 24 месяца.', 'subscription',2400,'foxes',1,720,false,null,0,true,0,0),
 ('pro-2m','Fox Pro · 2 месяца','Все преимущества Plus и значок Pro. Подписка на 2 месяца.', 'subscription',1400,'foxes',2,60,false,null,0,true,0,0),
 ('pro-3m','Fox Pro · 3 месяца','Все преимущества Plus и значок Pro. Подписка на 3 месяца.', 'subscription',2100,'foxes',2,90,false,null,0,true,0,0),
 ('pro-6m','Fox Pro · 6 месяцев','Все преимущества Plus и значок Pro. Подписка на 6 месяцев.', 'subscription',4200,'foxes',2,180,false,null,0,true,0,0),
 ('pro-12m','Fox Pro · 12 месяцев','Все преимущества Plus и значок Pro. Подписка на 12 месяцев.', 'subscription',8400,'foxes',2,360,false,null,0,true,0,0),
 ('pro-24m','Fox Pro · 24 месяца','Все преимущества Plus и значок Pro. Подписка на 24 месяца.', 'subscription',16800,'foxes',2,720,false,null,0,true,0,0),
 ('exclusive-2m','Fox Exclusive · 2 месяца','Все преимущества Pro и эксклюзивный значок. Подписка на 2 месяца.', 'subscription',3000,'foxes',3,60,false,null,0,true,0,0),
 ('exclusive-3m','Fox Exclusive · 3 месяца','Все преимущества Pro и эксклюзивный значок. Подписка на 3 месяца.', 'subscription',4500,'foxes',3,90,false,null,0,true,0,0),
 ('exclusive-6m','Fox Exclusive · 6 месяцев','Все преимущества Pro и эксклюзивный значок. Подписка на 6 месяцев.', 'subscription',9000,'foxes',3,180,false,null,0,true,0,0),
 ('exclusive-12m','Fox Exclusive · 12 месяцев','Все преимущества Pro и эксклюзивный значок. Подписка на 12 месяцев.', 'subscription',18000,'foxes',3,360,false,null,0,true,0,0),
 ('exclusive-24m','Fox Exclusive · 24 месяца','Все преимущества Pro и эксклюзивный значок. Подписка на 24 месяца.', 'subscription',36000,'foxes',3,720,false,null,0,true,0,0)
on conflict (id) do nothing;
commit;
