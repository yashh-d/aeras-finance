# Routes

Status: live = executed end to end · quoted = priced, not executed · built = code and allowlist exist, unmeasured · registry = address only · blocked = measured unroutable · planned = nothing in repo yet · untested = token exists, route never tried.

## 1. Tokenized stock → xStock on Solana

One row per ticker. ✓ = that source exists. Destination is the Solana mint in the second column; the same rows apply to the Monad xStock once Backed mints it (all planned).

| Ticker | → xStock Solana mint | Ondo Solana | Ondo Ethereum | Ondo BNB | xStock Ethereum | xStock BNB | Status |
|---|---|---|---|---|---|---|---|
| A | `Xs5drDwMFxkcChq5cU49EX2oTQUVWQ64qsSL5bVQoS3` |  |  |  | ✓ | ✓ | untested |
| AA | `Xs2XDRGh6AhivmYgaVa8woDGKGccR1WnnGnw9vqSWD9` |  |  |  | ✓ | ✓ | untested |
| AAOI | `XsGHwSbPaUJu6r5dtJLHXkXenPgCQf4Sx2hb4e2sbCZ` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| AAPL | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ABBV | `XswbinNKyPmzTa5CskMbCPvMW6G5CMnZXZEeQSSQoie` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ABNB | `XscSc1zjbVizEnhCzzehJ9fzztm3WRKdn9pjmriKDuN` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ABT | `XsHtf5RpxsQ7jeJ9ivNewouZKJHbPxhPoEy6yYvULr7` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ACN | `Xs5UJzmCRQ8DWZjskExdSQDnbE6iLkRu2jjrRAB1JSU` | ✓ | ✓ | ✓ |  |  | untested |
| ADBE | `XsDZMGEU8zadWFCkTtPBoPWYcUX3JHVmghnwf2Mve2q` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ADI | `Xs3CytsvJshAYy1TQjq2o2yVWCyEGinNpvkB6f3Qs31` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ADM | `XsK6kBQe7QDQVmW1PupBZCc4oBpPbsRdPgvqCqvfCXX` |  |  |  | ✓ | ✓ | untested |
| ADP | `XsCBDrb61PyQqTJp7uHhD4vj1MkD5UK6jpxUBbgG7i1` |  |  |  | ✓ | ✓ | untested |
| ADSK | `Xs2jBYo5VxMmuNjpBnMShsLB26dtK75bt42ag93ZdHU` |  |  |  | ✓ | ✓ | untested |
| AEE | `XssLKajmwH79hK14cqp65fFg2Eyteh23nmSaJpKRmzx` |  |  |  | ✓ | ✓ | untested |
| AEIS | `XsiXtK4niZXG2MFkDmgRcZskNYoetURTV9XhgRf1ESL` |  |  |  | ✓ | ✓ | untested |
| AEP | `XsP8GpS93XjmDg5oVVCVqZsffkWadVCqZYp4BFFJnJm` |  |  |  | ✓ | ✓ | untested |
| AFG | `XsEv23PPmUAxWJ8VMyN84tyJzEnUg4Yg3636Mvyw4Pk` |  |  |  | ✓ | ✓ | untested |
| AFL | `XsQ2JJPzG5EMvkRPSshA1mmpVvGPKBNYQmvuEnzpJhZ` |  |  |  | ✓ | ✓ | untested |
| AFRM | `XsKfV36es7HHpJFKrDqaaXSFC1dwsrwLit4N67JH5LV` |  |  |  | ✓ | ✓ | untested |
| AGNC | `XsycyYwi9Kekp26jyGg3x5Fo1JDRr3XnTJmVaf5CRUb` |  |  |  | ✓ | ✓ | untested |
| AHR | `XsLEJJP8FpnaSP17ETzVfkTQFHBP4i4hRvmz3RKX7B8` |  |  |  | ✓ | ✓ | untested |
| AI | `Xs7QhN79WzM4hjfHbu2W46ZRkdyumim3ooJHhPxenoU` |  | ✓ | ✓ | ✓ | ✓ | untested |
| AIAGR | `XsQk7zRMNmbgSr4ZnvANH4enGH7zkUAtahKuckYy7x7` |  |  |  | ✓ | ✓ | untested |
| AIG | `XsTg4SHooxeYYvQK5Q2wdKBKY46UdtZkF2LfNwbHEtu` |  |  |  | ✓ | ✓ | untested |
| AIT | `XsvJzDTuRrc3cWVwPXVcaXaFJFVtGcpDsfCA56z868Q` |  |  |  | ✓ | ✓ | untested |
| AIZ | `Xs7U7QD6amUpjuEZ1VM3rx5TSrKtJ3r7xU1aRcTHhw8` |  |  |  | ✓ | ✓ | untested |
| AJG | `XsYka4UhXnzoqmdPCfqX8EZBQcN2MkrG4gJt4SxGvsN` |  |  |  | ✓ | ✓ | untested |
| AKAM | `XsJW9EhZBVQawVj1aGFweU2LwQjZCvyHVYb3vXq8s99` |  |  |  | ✓ | ✓ | untested |
| ALAB | `XsuJLDjTibUFnh1gNgnXeDSjQTVffnaWFKzUht5rVvc` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ALB | `XsGea4488p7ydWQTQMYxtvCXDJiAJwgt4HsoKiKrGa3` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ALGN | `XsmMYEkQRXZ9CodFfqGEwNvtqVZdsDLHoYqPVm2EpHX` |  |  |  | ✓ | ✓ | untested |
| ALL | `Xs1kbMkmahb44LPLLdjscSYZ4c2HUu4WNfgk8P7ndQf` |  |  |  | ✓ | ✓ | untested |
| ALLY | `XsRifLZvp2XvCpPFQNK6XGTjHSL7sTZmmGyEs4NLAV2` |  |  |  | ✓ | ✓ | untested |
| ALNY | `Xs1asXCeRWVFLE3mun2UZhaY9VEDYfyjUhp5mjkjX7b` |  |  |  | ✓ | ✓ | untested |
| ALSN | `XsZLnz25FKoaHSjhGDYtv2E7sgKwP3g5XeC7eSWLVnm` |  |  |  | ✓ | ✓ | untested |
| AM | `XsLLmMhRTib24GrQd3wfrgh3rBWF6NHeVx6hox2eZXH` |  |  |  | ✓ | ✓ | untested |
| AMAT | `XsQZdaWUAGC4R3fgD2N1fupKvJfJq6YM51ccnsLUWFA` | ✓ | ✓ | ✓ |  |  | untested |
| AMBR | `XsaQTCgebC2KPbf27KUhdv5JFvHhQ4GDAPURwrEhAzb` |  |  |  |  |  | no source (Solana only) |
| AMD | `XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| AME | `XsVNxwvuQghf6TYBmCck75ddYD3KiWozujR8C67bPXC` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| AMGN | `XsgKwBMbv8LDzEYRgbKtyqsub6QB56PQVzgTGbiGaNe` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| AMH | `XsFUCDYcyPbbYKFXaNUU661ZGip7mwjUEEk3W1YPCrK` |  |  |  | ✓ | ✓ | untested |
| AMKR | `Xsqbg1tmAvNT5332hhX4hMSznqf2NJ1tz2cNWmAkRD3` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| AMP | `XsqWwT9y8ajA8LXQEy7msQmM6ExkP8Va3XYcr7oVhXg` |  |  |  | ✓ | ✓ | untested |
| AMT | `XsvYPZkrDDg7259oDv5E76HSmeLWgHPgNEQ44KVbJJU` |  |  |  | ✓ | ✓ | untested |
| AMZN | `Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ANET | `XsrsM2RgtYxXqxmy4iWgxQJUkkHG1U5wzi74sVNUW8m` | ✓ | ✓ | ✓ |  |  | untested |
| ANTAS | `XsdP2Pc9F6UsUujiydSsBGZGNYpDMivEjNfQ1ytHD1P` |  |  |  | ✓ | ✓ | untested |
| APA | `Xs5b8FFins32GgTH2FURV3Y873yA85jc4kZ6r8H9YyR` |  |  |  | ✓ | ✓ | untested |
| APD | `XsdeDQyocwoXYq4rvm3eAxN4uDUqww78i9nKLABhp6h` |  |  |  | ✓ | ✓ | untested |
| APG | `XsNKyNtZCbtcCFtJHSeKTGqNQ9gCEaAaKrZBzPH5LLS` |  |  |  | ✓ | ✓ | untested |
| APH | `XsvqNba1k4wF5ZEZ6Nrx8AXUDkKzAFuj4HaVDEemyYH` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| APLD | `Xs2ZEuDVSQkNnXHqfqEYKVShLHpecyKfdfpEYwiHtQE` | ✓ | ✓ | ✓ |  |  | untested |
| APO | `XsosRSUc3n5pod3YNNyQ7go6811xWYd3YME2uEQohEx` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| APP | `XsPdAVBi8Zc1xvv53k4JcMrQaEDTgkGqKYeh7AYgPHV` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| AR | `Xscms1jQDud7fsxLTKibMVxSTSQz3JFeJ1HDshRkPwc` |  |  |  | ✓ | ✓ | untested |
| ARES | `Xsm7SVTuyeaeD5fwaWD1RFKX7Rr8WmNGz5j35r5npth` |  |  |  | ✓ | ✓ | untested |
| ARM | `XswUFSYE5CWsZM3X3yo6e2pZvxcAzx912DonGvgUFka` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ARMK | `XsVhUJLbtEhVSPHFcyjZYYXJqmK8j8kfD553wZ8of6W` |  |  |  | ✓ | ✓ | untested |
| ARW | `XscZvQvu7gYS4yuF3NcCeDbQjQynZ823xGCk9uUVePN` |  |  |  | ✓ | ✓ | untested |
| ARWR | `Xszh2XpEww4ndD8CyFzD5DcmqXpw7HMkEdSU1Ngunbe` |  |  |  | ✓ | ✓ | untested |
| AS | `XsoxUeZzk47VGpqwE9wLi3DM9xuHSSmnsfXmvZH2bxw` |  |  |  | ✓ | ✓ | untested |
| ASML | `XshuHQ6o6SVpUNawvnnTMxsZ4tacZsNgVCLorv7TkFq` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ASMPT | `XscQZXWUx2vw2cP1oQSBgRVJaky1pV6anaAKomxoFYn` |  |  |  | ✓ | ✓ | untested |
| ASTS | `XsR4LAtaBgTKTRUhiijY1ba13nx4bepeEcag2Pr4dZ1` | ✓ | ✓ | ✓ |  |  | untested |
| ATI | `Xs7jmdBozN4RTu3YgSZeLcimiHJcsovXjvRtHhJbafT` |  |  |  | ✓ | ✓ | untested |
| ATO | `Xsz1UqWKSjB4X7zcvXV6XVL5eBA2YaRqEjXZVP6GXwZ` |  |  |  | ✓ | ✓ | untested |
| AUR | `Xs7x2HYEazWDXpYQYPBiRYh6o2AbkYrdrFwaBfBxyaU` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| AVGO | `XsgSaSvNSqLTtFuyWPBhK9196Xb9Bbdyjj4fH3cPJGo` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| AVY | `XsAfpyk9U7qUZKq9STpXyzDaoQjGRe6Yqo7TYebpxkx` |  |  |  | ✓ | ✓ | untested |
| AWK | `XsUQA7YBvJyBXDrQy23WNydKWdhVCPRVMxEF6MgXytd` |  |  |  | ✓ | ✓ | untested |
| AXON | `Xshh7vNfHqyqbnfuvhn8o53wXcuUbBYKASPq8DEHPbx` |  |  |  | ✓ | ✓ | untested |
| AXSM | `XsYa1w57EZDEiryphKCD8AJf33f4ewr2BHUW4RcjSuE` |  |  |  | ✓ | ✓ | untested |
| AXTI | `XswiwGt897dzZU8eHoojgUu2ka34brmPGvWeVHcHho9` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| AZN | `Xs3ZFkPYT2BN7qBMqf1j1bfTeTm1rFzEFSsQ1z3wAKU` |  |  |  | ✓ | ✓ | untested |
| AZO | `XsfLtqmidw4ouMrdWvH5usSs3r77Usm6rXGygxhRTjz` |  |  |  | ✓ | ✓ | untested |
| BA | `XsBcnKnZMsPaerLiUQ4eMFy4Fjysot4RugYXYDjiqCP` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| BAC | `XswsQk4duEQmCbGzfqUUWYmi7pV7xpJ9eEmLHXCaEQP` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| BALL | `Xsy9RdWC26fp8c84BB2SD4eE74vG1478YKjxAwjRRQY` |  |  |  | ✓ | ✓ | untested |
| BAM | `XsLdXScusw7mCSATbp7bWKfyBR1RVWEEayKgRcmJ8dZ` |  |  |  | ✓ | ✓ | untested |
| BANKC | `Xs3uhDYpQGfkeZ7rrzQgmozWQHC5uDLUa6iAN65qHM1` |  |  |  | ✓ | ✓ | untested |
| BAX | `XsFo6dYyRQwVtxbfdGs3zwyyQ1QBkh8D4ANjWXN3zTo` |  |  |  | ✓ | ✓ | untested |
| BBIO | `XsbJzb2V963yBoCKjRJqSLbNUeBsqy6uV4dVnCnNp4q` |  |  |  | ✓ | ✓ | untested |
| BBY | `Xsac5qkc4B254kpnb2qneeu6qsNX1fPtACeuNEiXWMR` |  |  |  | ✓ | ✓ | untested |
| BDWAP | `XscpBVm2popZi9D3rPNEV5fyxonLfJeTZ8iFeowZQ9b` |  |  |  | ✓ | ✓ | untested |
| BDX | `Xs3yrczxLidKAArdTKepU5NV8KUmwFM11NMyYbGqWDZ` |  |  |  | ✓ | ✓ | untested |
| BE | `XsmGSEqT6VXpVis3aVBDxaNwPgHNXbkjkVUCncsLkNB` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| BEN | `XsHXhZf6yLqBvcbuswpbio7m6yNTMrMiQWWN7csQMAr` |  |  |  | ✓ | ✓ | untested |
| BETR | `Xsv3MnH24RsSJwcBvkPUMsDAZqszgmxnbWcUDbfzaYW` |  |  |  | ✓ | ✓ | untested |
| BIIB | `Xsv9aoiWTdvBzVpvetL7LBkuS9xvceDdbLkfqMbTVDx` |  |  |  | ✓ | ✓ | untested |
| BITX | `XsraCsjDB8cYn672MZSxCzZBhrodEPXD7pWd5EiRUhm` |  |  |  | ✓ |  | untested |
| BJ | `XsAGAMqiAySqkUDf5ZXCTR4v6hSgcBj7mQQy7w3Nja7` |  |  |  | ✓ | ✓ | untested |
| BKR | `XsBE7iAzaJEBpSwG5JZ7zQTWNgTaerweBy7nJCachaJ` |  |  |  | ✓ | ✓ | untested |
| BMNR | `XsrBCwaH8c46xiqXBChzobgufRKxQxAWUWbndgBNzFn` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| BMRN | `XsF6swLUV7mDXkG39Ywmgouktp1PXaJ3oyGnCDvYs9G` |  |  |  | ✓ | ✓ | untested |
| BMY | `Xsa3dm4UT6TdzPJV75UiuGUeGywYUnfSNhsV5nHPZEu` |  |  |  | ✓ | ✓ | untested |
| BNY | `Xs2hXX5B6aYUn1Nf8RkspKQbBTjbsa1Co9SjpwgZbNr` |  |  |  | ✓ | ✓ | untested |
| BOCHK | `XsdyyYJSCDVHBdAujSoWnQEDBQi9Y85YxoGVueJNf1j` |  |  |  | ✓ | ✓ | untested |
| BOCOM | `XscjyoChdmwiZwDzQZQXEVFsyYTc6Bhfn9TzyfufjVd` |  |  |  | ✓ | ✓ | untested |
| BOT | `Xsi8P9r7ZWDBBnBj9JTfnKWqyKNV19X2CQPWQsGdjnS` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| BPOP | `Xs75Z8HFGHFnTubABp1CZSLvzCPepWsYhtHYLAFYEa7` |  |  |  | ✓ | ✓ | untested |
| BR | `XsvEMALzsRVnPED4KEAd7pivT5ho9vgqzqZxQxNBkWW` |  |  |  | ✓ | ✓ | untested |
| BRK.B | `Xs6B6zawENwAbWVi7w92rjazLuAr5Az59qgWKcNb45x` |  |  |  | ✓ | ✓ | untested |
| BRO | `Xs9hw3a4acJr629NUzDbEC376rv3AhfmwvXm9BNnD9G` |  |  |  | ✓ | ✓ | untested |
| BSP | `XsYMHtwJcWon5GkPHzdDbCCztKtKzEurJnbydxgjsqS` |  |  |  | ✓ | ✓ | untested |
| BSX | `Xs7vm4sZj1LiNLvnxUCyUTuxRMTt4WGJfdbCASTYhN9` |  |  |  | ✓ | ✓ | untested |
| BSY | `XsMJnAApxALiWrwPBkAqm2FebHRmMLQVyjv9xVckzyk` |  |  |  | ✓ | ✓ | untested |
| BTBT | `XsPLBFy59Q3hY59KLAJur8QyvziMF4xUxGTxXqXE7cT` |  |  |  | ✓ | ✓ | untested |
| BTGO | `XsvHMmbDcd14DHHW16PkxPGW7ks77ehxUv1E9Zmxgj4` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| BURL | `Xszn8sMqeBqfLDXAsDa9uEYo6WT3LYSD4jje2pGK6k5` |  |  |  | ✓ | ✓ | untested |
| BWA | `Xs34rXKEs63rPs3qWZeAubRmSVJNG5hSy6Ubt7Qag2F` |  |  |  | ✓ | ✓ | untested |
| BWXT | `XsVpsBVdjW8SWAu4jAjqJ9qnGYzBmUzNDRcG6uiZ9xo` |  |  |  | ✓ | ✓ | untested |
| BX | `XsYtTeabUTJnkxWrHZUChwcKpNq6BbqPbWs9ZgLk4Xa` |  |  |  | ✓ | ✓ | untested |
| BXP | `Xsc3DUGC7diNKyYkKTagzj4R42EuM8KHBgFnLmXA12y` |  |  |  | ✓ | ✓ | untested |
| BYDCO | `Xsbcv5nSVTc5A7jRZNe2Sg6VtgCyyb32SC2nnaPK5MZ` |  |  |  | ✓ | ✓ | untested |
| C | `XsM1FstDXh1pA4uNXzvJdAop9SRJnnRdWt2o8A2mLpN` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CACI | `Xs7wD8JEF2KoED55Re7W6GDoHwA5QPGJvLwQYHYw5wr` |  |  |  | ✓ | ✓ | untested |
| CAH | `XsrstNGy7STAR22txNru2ahbEwdBadFJwYRCBNEQYBS` |  |  |  | ✓ | ✓ | untested |
| CARR | `XsvQh2FdVWMpbNsnYAbDNg38GtAWBEjcweJR42yRTgy` |  |  |  | ✓ | ✓ | untested |
| CASY | `XsDBYWqoxayY5cqFWs6jNJn4wv5vbP3RkTNqceEQRGW` |  |  |  | ✓ | ✓ | untested |
| CAT | `XsRvd1meWQ9kW1SrZPa1jokQqmBoPWWjd6wGTgdp5E6` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CBRE | `XsTJV8FFx22kv41kMcuHawx8eoDybUnLxiiEscw317x` |  |  |  | ✓ | ✓ | untested |
| CBRS | `Xstq9oUsBPd8LSyivHhnt8P8t9xK5RYoM9P6izLczvm` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CCI | `XsbPN4VFi14geuC8D2Tb2u37kQM83VSkfMUyvXsWWoC` |  |  |  | ✓ | ✓ | untested |
| CCK | `XsHjSQhp7Eac5azSKy7cZbZGCrpEUAA3RseKh2X7c8C` |  |  |  | ✓ | ✓ | untested |
| CCONB | `XsvPonyU9dZWsZsT2rJ1MBRAmPw8gMtS7M3ERko8XkK` |  |  |  | ✓ | ✓ | untested |
| CDE | `Xst5zttaWoyT8Td5jNhxwVQ1ku4bSRv8EVJe3SHoGdc` |  |  |  | ✓ | ✓ | untested |
| CDNS | `XsrB8RyBpbMWm8zCQutdT2n95BgNj4rJFfxuhHFjk2v` |  |  |  | ✓ | ✓ | untested |
| CDW | `XsMmhKdFMiFdNFBcznYHx2zAU1SLtMnUL2G6bRzPpaY` |  |  |  | ✓ | ✓ | untested |
| CEG | `Xssu2cDLdZXZYrq17frTVrb3meumRCAzEf7pXyxoWVN` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CF | `XsH9yfX7GuRbCDnNvD4A7x8gvMc8sc8Htz1fQd7VYWw` |  |  |  | ✓ | ✓ | untested |
| CFG | `Xsp9avBowUQeip8NfLXcwfw5VT74kc72BafgYPXN74a` |  |  |  | ✓ | ✓ | untested |
| CG | `XsaLeEQ2RtXLwLYBtJv1wT7CXk4paWCvKxNWMNk4mbZ` |  |  |  | ✓ | ✓ | untested |
| CHD | `Xs712gQLCYkFSYJwdu3pE5itNfyKwsXQ1HEGZF8Esc5` |  |  |  | ✓ | ✓ | untested |
| CHONG | `Xs1Pd2VsTd1MBDnnBNtH2V68Z5WPNtMmYmE9cuMoBcT` |  |  |  | ✓ | ✓ | untested |
| CHRW | `Xsm5zBfHeiGWjraGLwT8DwJhYGjUfhESs7QANcYVp8E` |  |  |  | ✓ | ✓ | untested |
| CHTR | `XstvDoqmcKjMHZP8FoWy3Ee2EkCf4KZgqNtg21WFW3X` |  |  |  | ✓ | ✓ | untested |
| CI | `XsGfYyioN9bfk6M6RGKvucDq8grQehqkBz8ziEtT124` |  |  |  | ✓ | ✓ | untested |
| CIEN | `XsE5qZhg6oL1ypWwtwXPQtW1EpFSvRmLXk9ceX9TtZx` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CINF | `XsNufzbQz3zzhuGTSBi73Rds6wo1ghjn74ooK7ZbLVX` |  |  |  | ✓ | ✓ | untested |
| CITIC | `XsdSGGAQyFiEuCVyV5ZQgB79pXXpr7vZPm3nhvHwKzK` |  |  |  | ✓ | ✓ | untested |
| CKAH | `XsEV5rBKdRtbmVLXmCxTm6Dox3467drekVVwpupVLrP` |  |  |  | ✓ | ✓ | untested |
| CKHUT | `XsjMBmvjeERTrf2odjQKQKFgBVWsiC5J9Mhe9eCNyfW` |  |  |  | ✓ | ✓ | untested |
| CKINF | `XsgYr5PbwmUuQTDFwVDAx2M4KzZKwz2zvYMzg4Nuwym` |  |  |  | ✓ | ✓ | untested |
| CL | `XsWzjAeMsR9pMX1aKkq7uDKpr11daUHkmjXya15yCqd` |  |  |  | ✓ | ✓ | untested |
| CLH | `XsRwkmMcYT1jEJ9cnUsnWkUitWJRufu2qCmd6fbRRYj` |  |  |  | ✓ | ✓ | untested |
| CLINS | `XsoHpcJS91HhgMCe9ApwgpXbXFjV4ZoYATsZ5WQM4RB` |  |  |  | ✓ | ✓ | untested |
| CLONP | `XsyGQnVqV2XoDzSGsHoemfpvpctbEMtqdBvRk1nGnLZ` |  |  |  | ✓ | ✓ | untested |
| CLPHD | `XsC1MeKZhxG5mv1h6oen9YVT2Skfxa3GMVkXymkTF8N` |  |  |  | ✓ | ✓ | untested |
| CLSK | `Xsn3H7ACEpSF2ULxeiD6kW4jRZXpurh8ZPttyfoS56W` |  |  |  |  |  | no source (Solana only) |
| CLX | `XshmkFbMrRMtVb2HoJw1nc9jGMKNjTWcutT86YpMbKi` |  |  |  | ✓ | ✓ | untested |
| CMCSA | `XsvKCaNsxg2GN8jjUmq71qukMJr7Q1c5R2Mk9P8kcS8` |  |  |  | ✓ | ✓ | untested |
| CME | `Xsx234fZF5KMZ5catYi7m9P682Pk9TWWHF5jAfYGZJk` |  |  |  | ✓ | ✓ | untested |
| CMEND | `XsD87ikehM9bu4pEdyT32TdMP2J5ph3F1uBCwEFdLUo` |  |  |  | ✓ | ✓ | untested |
| CMERP | `Xsa8uVzPAfd1FwuHEhVXKFj9Nn2Bprn4DAzUw7Hz7SR` |  |  |  | ✓ | ✓ | untested |
| CMG | `XsR1ktNCRYDoDNxhaSxF6NX2HyT4ACSQBgPRLpXTWmm` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CMI | `XsqZ16VmoeszDniTfGTnwPBMv7j7uSDArddziagHWit` |  |  |  | ✓ | ✓ | untested |
| CMS | `Xs6Udev3M1atxRjjXCjAg24BdjYuLs6Qj7eTh7XjEjW` |  |  |  | ✓ | ✓ | untested |
| CNA | `XsKfL6LbQaqnUfz3QZrBVwS3RqP34NKR3cmvbRu3doJ` |  |  |  | ✓ | ✓ | untested |
| CNC | `XsegJtRFtvC3qqhNYdN2QXxumd2fjvWQmithQZ33ehS` |  |  |  | ✓ | ✓ | untested |
| CNP | `Xsx9i1A6e4xc9r5Gxxy4uZV4YSmwAXBJScvGLRv4nH2` |  |  |  | ✓ | ✓ | untested |
| COF | `Xstd4ems8vhfGwTngpXCzgnSvJ4oD7E5gExUue2KEZX` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| COHR | `XsipFyePxrgwZJrX4s26RJ25cqwpkfn6ec8JLy26w5b` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| COIN | `Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| COO | `XsWetupD7QGe8e5fXsJAPHYFXFTUdYVjT44hJMsVDtY` |  |  |  | ✓ | ✓ | untested |
| COP | `Xs58CxmUcgT17reeVV64se747XuRfjsJQnpb8DX9TDq` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| COPX | `XsybfiKkD4UmjkAGT2uR8X2sq9AWFtvGJM2KTffoALZ` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| COR | `Xsst4VThLi3nvYTsNCVwJi1z23LfXrdyKmhArkrSn1n` |  |  |  | ✓ | ✓ | untested |
| CORT | `Xs7YhGRdqb6nzTTPqViWue7TT3EXbmWwmD4XdrnW3Ux` |  |  |  | ✓ | ✓ | untested |
| CORZ | `XsBGEXxbBcuu8Nrokj14G8v4ezT3JYWWLneTzXK8t6Z` | ✓ | ✓ | ✓ |  |  | untested |
| COSC | `Xsq94yaNbSREX4vckv2jKRaZziduQMQX3nwDm4eJNet` |  |  |  | ✓ | ✓ | untested |
| COVEL | `XsSWT1Cw3vemPuy82ATtfT8R347jctHVri1m2NzfD2G` |  |  |  | ✓ | ✓ | untested |
| CPAY | `XsPtqd1RVDcZzSmeVwY253J4EHVUqMSrR9FcFmjZjqq` |  |  |  | ✓ | ✓ | untested |
| CPETC | `Xsk88vf8LbRSVFTd9nu7kBsC2hNpQt4UckiV7eLSct4` |  |  |  | ✓ | ✓ | untested |
| CPNG | `XsoVbMATH8hMemisZZvGCc9YEkve3Yiirr2VtinKTuw` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CPRT | `XshHba6o5aAUPJFL19gmvSn4KRk6N44JVgiFt6UoRsB` |  |  |  | ✓ | ✓ | untested |
| CPT | `XsvoRXtZZfwvkLhp4qKPR9B9mcbuWakDUWnPszYw2BT` |  |  |  | ✓ | ✓ | untested |
| CR | `XskkJXTNFU8cFstbYCAtxTa18tLkuRFe1AWHQhiBLy7` |  |  |  | ✓ | ✓ | untested |
| CRAUT | `XsN23gnUFVBFR2RL9pQicMG1NNy56okJ9eTTQUSNubA` |  |  |  | ✓ | ✓ | untested |
| CRBG | `XswAx2kd4aKQtTszJ4zuA4nAY49hHzT82Vn8DqNcktY` |  |  |  | ✓ | ✓ | untested |
| CRCL | `XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CRESB | `XsptDxuTbpFNx9vic5CMDRiGzPDhNDcVp2i9bUdTktn` |  |  |  | ✓ | ✓ | untested |
| CRESL | `XsbsVbQ24JD4HKnrz4eLktPBgZEMX3cooqiFapFjUtB` |  |  |  | ✓ | ✓ | untested |
| CRESM | `XsKFSq4aTzj9L2g1rqbdcewZH3bZNE2WwWBZKcGNxsX` |  |  |  | ✓ | ✓ | untested |
| CRESP | `Xs22M1UvnSTzoiVopRbsYxcSFX4caT93eQgx27R8Xu7` |  |  |  | ✓ | ✓ | untested |
| CRM | `XsczbcQ3zfcgAEt9qHQES8pxKAVG5rujPSHQEXi4kaN` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CRS | `Xs8FjYWcxTREaUj5hv77f4M2UCreGfP7HegLvqzX56X` |  |  |  | ✓ | ✓ | untested |
| CRWD | `Xs7xXqkcK7K8urEqGg52SECi79dRp2cEKKuYjUePYDw` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CRWV | `Xs3trfdPXSZuxBJsgau6HRfu8SdrCirkwHpPNgSpJz9` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CSCO | `Xsr3pdLQyXvDJBFgpR5nexCEZwXvigb8wbPYp4YoNFf` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CSGP | `XsJH1qPyJgbJiYo2KZXNirCQxC3QqQgYE1iNHY3Ecm2` |  |  |  | ✓ | ✓ | untested |
| CSHEE | `XspgPmoq1m39tGMLmourzxXgGmSLbjfxiytABBwGA2u` |  |  |  | ✓ | ✓ | untested |
| CSL | `XsATdqpeobhFEM71r5MgZe4E5BcHuWk6jSnYnHLYTwS` |  |  |  | ✓ | ✓ | untested |
| CSPC | `Xs5hnQoLHnA2xeHaaxYGkCV2Kp12SwCEeCKBK7BW3gr` |  |  |  | ✓ | ✓ | untested |
| CSX | `XskJzVZDKvqm999PGat2ifznPVmmDXn4Zi1LZ7Y5CVr` |  |  |  | ✓ | ✓ | untested |
| CTAS | `XszBTLtg8oMmEWsZHbJJwViiB6unNh2ei1e6miArqps` |  |  |  | ✓ | ✓ | untested |
| CTFJW | `XsWgkRwEBBWSzUTXX8CU84LpRheciMF8o6ZdSMR3Gny` |  |  |  | ✓ | ✓ | untested |
| CTINS | `Xst1K519UWCXvw2nKW6qHWfiUmFA3ybvvYpifzYhTWF` |  |  |  | ✓ | ✓ | untested |
| CTPCA | `Xs9ZqDkZpNZ62FMdQeAQhz5a9fNQ7hXy2XCWDvEnpKn` |  |  |  | ✓ | ✓ | untested |
| CTSH | `XsMNmV7wVizphwXgMtXTVhLDpqmKPdfoYPK3JTXXnYW` |  |  |  | ✓ | ✓ | untested |
| CTVA | `XsJXYLby91CWhGhTXds9oxjoc8EdsLy2iuxmq55U1Y3` |  |  |  | ✓ | ✓ | untested |
| CVNA | `Xs8YT2AdFmjuG2HFjcvVTpXPwneiKNHMrR49muHY7z9` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CVS | `XsKWyokwxJfb5aVBfDJYGte4wk2NPMNFo6SivouPeSy` |  |  |  | ✓ | ✓ | untested |
| CVX | `XsNNMt7WTNA2sV3jrb1NNfNgapxRF5i4i6GcnTRRHts` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| CW | `XsWCYadcnfTLH3W8sBbJZepwotUkfV1qg7QQmzVo8M8` |  |  |  | ✓ | ✓ | untested |
| D | `XsiYzgRPqPjAaJjpDMo2CaQ7c9khuCwD7Hj1po2dxSj` |  |  |  | ✓ | ✓ | untested |
| DAL | `XsQVuhV5fBEb3b8TauFuRimcXSJdVrKqFgQTVqLZiq9` |  |  |  | ✓ | ✓ | untested |
| DASH | `XsuW1yxtbifjEYojFLmoavTWBT7hsuUXXeReAWK9X91` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| DAX | `XsKbKZ6e1BtERDn2cF11WkpVwvzSWCrf83AMafgnMQT` |  |  |  | ✓ |  | untested |
| DCI | `Xs1n717k7fpA1edvo1xndLzPGYnkF81MPFsW3CC8jiZ` |  |  |  | ✓ | ✓ | untested |
| DDOG | `XsQJQHNMLiZCBHgJfq2yK95BFraouUdSspv1aD8jCgQ` |  |  |  | ✓ | ✓ | untested |
| DE | `Xsh3Lt6pLpH65udstiFuZThJ6gyQTL6ryVXtNwEy5zd` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| DECK | `XsbahiFKw3f3pgsAwREvQZAdERbV1NGUjWnkzUaBz91` |  |  |  | ✓ | ✓ | untested |
| DELL | `Xsu7Tc5J2fVUE4H5vYAiSr34cvLJeCsYPMjAYnayQn6` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| DFDV | `Xs2yquAgsHByNzx68WJC55WHjHBvG9JsMB7CWjTLyPy` |  |  |  |  |  | no source (Solana only) |
| DG | `Xsuex5gGigmPKMs6hsYpHbcg8HwBbBdWkGKub9MQbea` |  |  |  | ✓ | ✓ | untested |
| DGX | `XsFyCPFNa7os3PvzuYQJcpws9WQS6bci2W8zqesHwPN` |  |  |  | ✓ | ✓ | untested |
| DHI | `XsiNAvTHpvygKjMqb8Hz5Nqeo8NTAsWzT6DYLH287FA` |  |  |  | ✓ | ✓ | untested |
| DHR | `Xseo8tgCZfkHxWS9xbFYeKFyMSbWEvZGFV1Gh53GtCV` |  |  |  | ✓ | ✓ | untested |
| DINO | `XsVuEGU83SBvgQiuynK2qtinyPVyKukoTCACdJg2767` |  |  |  | ✓ | ✓ | untested |
| DIS | `Xsg93jDV656ULQ5u9yT2x5DS9b4xGD8aDCtfESSW6Bb` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| DJT | `XscR1RVZydyrL6Wn7WqbW2k6EmkLuS8SqDzuyptwxoj` |  |  |  | ✓ | ✓ | untested |
| DKNG | `XscCMVe1Qu2rk1YoCDJGwMLZkfVnd69xcPER4DJ8tpB` |  |  |  | ✓ | ✓ | untested |
| DKS | `Xs9aEtZqQDzTtb1PLVJ2W2d6NGJSSaJepTsQ2CZAjhn` |  |  |  | ✓ | ✓ | untested |
| DLR | `Xstp4CYu1181rhhi7w32Lj6wQZ2VDjFhQNKZwZARk5G` |  |  |  | ✓ | ✓ | untested |
| DLTR | `XsPWGRNQF1Thif9qaadTNtF8xfHTb8sjvw1NC46hkED` |  |  |  | ✓ | ✓ | untested |
| DOC | `XsgtMhyQgTevrWQNyLpHxwQeRAeaxQEtoiV1pNyxmfy` |  |  |  | ✓ | ✓ | untested |
| DOCN | `XsKJGRCayh5LQ6bsET8ZVip8BaRZbWmj9fjSnCcy9P6` |  |  |  | ✓ | ✓ | untested |
| DOCU | `XszH3SckdYS1Kbyj9wcmjttt9Lp8jMgU39rGL8b9Wcp` |  |  |  | ✓ | ✓ | untested |
| DOV | `XsXG3ytqNM8wMwxbZnbZjY3wFua4nU58ZR6Lwr5wSDp` |  |  |  | ✓ | ✓ | untested |
| DOW | `XsKWMeTN8wmhrkoWKy6tXAj6476Guj8zonzQu7jivqP` |  |  |  | ✓ | ✓ | untested |
| DPZ | `Xs6z8AmfhiHTGmfdcX6hG7hho5P7xnbE21ChtJ94oVj` |  |  |  | ✓ | ✓ | untested |
| DRAM | `XsESMQjWyDczCfiJ3QDjZEiaKwp1uXYp3TMZ6viuLcm` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| DRI | `XsTNaRrDQtFJi56TAQbmk6tHzWQvihWGoafKSJzbJdY` |  |  |  | ✓ | ✓ | untested |
| DRS | `Xsf3NfLggzL9WXy4yaxJB3866ehq7y7sQxohwAkNiEu` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| DT | `Xs8Jb7S3qqWbgkRGvwKmT62MD7gt1qYU7oUaR9oDC11` |  |  |  | ✓ | ✓ | untested |
| DTE | `XsVK4gk4X1ANBSKF9DGjy9WseKhBfMUuEmP8v7J8u2G` |  |  |  | ✓ | ✓ | untested |
| DUK | `XswU7kXY6dGgMqpiWW2jKSYVZMsCWv5LKcLaFBgYzPv` |  |  |  | ✓ | ✓ | untested |
| DVA | `XsS3GWSysqkDJZYFSuMDFZ2ELSjQAWwMH28vxLThnb4` |  |  |  | ✓ | ✓ | untested |
| DVN | `Xs8WNVWbYNsHsqEu9WTb9AazMfG7wFxFat11V6mVK1x` |  |  |  | ✓ | ✓ | untested |
| DXCM | `Xsspestq9YiZofYG2pvuHgYM1aKdRNocveBodzrGjbg` |  |  |  | ✓ | ✓ | untested |
| DY | `XsHsqDrvsU85aJXNNmPBkxU4STbELJUeTV7zT4cJQD5` |  |  |  | ✓ | ✓ | untested |
| ECL | `XsPPAW5wuUa1ALN1NstEkUAajbwycXTRxtWoLfFriy4` |  |  |  | ✓ | ✓ | untested |
| ED | `XsESyqE7kRmE1RVQDmo4aiMGMXogeY1Sdo8FQKwAmco` |  |  |  | ✓ | ✓ | untested |
| EFX | `Xs3dfAaDSQMVrDcEVbxypK4UeXhCbDBK2AgAWCHwqmq` |  |  |  | ✓ | ✓ | untested |
| EG | `XsvYonMjAxFXYW6PKBz9jFEuvX6xAhm9BifzxgLzurb` |  |  |  | ✓ | ✓ | untested |
| EGP | `XsuAyd21vBFvAJfpzYQgmTi3A9Qwb6feHmNVsU6Z5vM` |  |  |  | ✓ | ✓ | untested |
| EHC | `XsM3qqkARr8UMejnZUU3gBs7hz2fUdxDP35Dhxx9z94` |  |  |  | ✓ | ✓ | untested |
| EIX | `Xsm4TwT5UtCCjkcrj2eMZDPNCTdBeJacMmRCrxoXpZ8` |  |  |  | ✓ | ✓ | untested |
| EL | `XsTisPuTVM8VVHagEyeGR7CBt6TUD93AEhptETHWMsd` |  |  |  | ✓ | ✓ | untested |
| ELAN | `XsKLqYX4dXLxZhM7bXyNsQdf5P1wFAuwLYaSPqt3j1q` |  |  |  | ✓ | ✓ | untested |
| ELS | `XsMPKfVuLeJ4mSahPcSgVGHEVGt41QU41CfgfvRzvBG` |  |  |  | ✓ | ✓ | untested |
| ELV | `XsJbC4TFupSLpxNwsfq9o1BB5tdTT7eZ3YNerVvE49H` |  |  |  | ✓ | ✓ | untested |
| EME | `XsHsi7FvQo4T7AkmtyszYkhNdKDCVgrJFS7CWGeaeM8` |  |  |  | ✓ | ✓ | untested |
| EMR | `Xskqq9tKh2gc1PBJHf2q6jMgBpt3AojT3HVkWhjoY5h` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ENHA | `XsGAnis8BY5TLxEGdPY1LeeqY1DHPcUkkBQWRyQaJya` |  |  |  | ✓ |  | untested |
| ENNHL | `XsfTYmMC73C6xJsc5k92ZWBdQtEtmnRsVtkN9s5RPQZ` |  |  |  | ✓ | ✓ | untested |
| ENTG | `XsD6kFBZCYumf4awQ9tgFFh8m2HGJBtTFdLYt7HcwRr` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| EOG | `XsfBx5h3LBhypgy7goD4i8nAfLU8ZZ5QBSQUtASRVox` |  |  |  | ✓ | ✓ | untested |
| EQH | `Xsf8f6sqb9p6JK9oR8UHXk7CmFDvofc1nxeink7AoGA` |  |  |  | ✓ | ✓ | untested |
| EQIX | `XsBo6pg8N9kk7YnL69NnBBSZBWDkF1gHWjTAXpYuAVo` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| EQT | `XsvS1ZY358vAjNJ7s3fz13s64ZqYF36rgUDR8yVJkuA` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ES | `XsgPX8MYf23yPRv9DrT5ofHn4mThBZgkhboLHz5uSx7` |  |  |  | ✓ | ✓ | untested |
| ESS | `XsZsYW1U5exCzHqwsxwjTDABR2SW9MzKccXSkAgx47N` |  |  |  | ✓ | ✓ | untested |
| ETN | `Xs8S5L4HkJpeBWF1J4oyUX6rVwGHmG7GZ7PiChPt7nY` | ✓ | ✓ | ✓ |  |  | untested |
| ETR | `XssZsJPrzg7n9Sc1stfPcB4vygcVeMfz5uZK2gPwNdv` |  |  |  | ✓ | ✓ | untested |
| EVR | `XsmTgboNTsssYV1VZrS4u1YMkcNWTKVMzUjghkXa3RF` |  |  |  | ✓ | ✓ | untested |
| EVRG | `XswxMcsrN9WpDhX7wDf53ZFGWNhcWYKSa6UY26AgpET` |  |  |  | ✓ | ✓ | untested |
| EW | `XsSfT8eYeR2NqYFwCNLRNfDARHUTXvLeSnGbw2UKqrA` |  |  |  | ✓ | ✓ | untested |
| EWBC | `XsitAUXgChdnHHVx2qa1Fhw6xe5ZPog1XrEGg4Pp5XW` |  |  |  | ✓ | ✓ | untested |
| EWG | `XsM51PKxDNQBZR65VRxRjNqcMWUBoYwHeVn2FR6WXi9` |  |  |  | ✓ |  | untested |
| EWQ | `Xs1neEMHNaDDSHqE9nvDGkmuX73ZASKcLtQqwmVAQde` |  |  |  | ✓ |  | untested |
| EWU | `XsbWCMXPzLdZMLpPtiiWE7M99fySmsnK5eFCWGWfDQ8` |  |  |  | ✓ |  | untested |
| EWY | `XswenHXJtDWYMh89uRYx2tZcABxwXSn7j3jidDPS1Yo` | ✓ | ✓ | ✓ | ✓ |  | untested |
| EXC | `XswJRi3vQhng81dGRXnaUjpyCzM89pwvYyHveT2xzEB` |  |  |  | ✓ | ✓ | untested |
| EXE | `XsodbeGRpfyAzq1MMqZu7u1vCYNKNDuYrCtofaT1PJK` |  |  |  | ✓ | ✓ | untested |
| EXEL | `XsAPSDzHwPr2UX83cY4KCHSdyvfighyeTPLaPXq1m3o` |  |  |  | ✓ | ✓ | untested |
| EXPD | `XsJB61YjcXkEf114fDGMMnWhhFf8a1x12Z6hARUUeAM` |  |  |  | ✓ | ✓ | untested |
| EXR | `XseFccApcVhrqASiXFM97ZkX7a2uDWbUWjC4T82LgAT` |  |  |  | ✓ | ✓ | untested |
| F | `XsBNJXGu68cBH5hgFxdqZkeh8cMQv32jeEtZtYTYvfS` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| FAAA | `Xs8rb8QG9mEuQ41g2cUzuJLZt3xEPQFhvgb9s4obXSn` |  |  |  | ✓ |  | untested |
| FANG | `XsdLjeamzdsWW5aBhsGVAaQFcZtCL6yF9nhtWfszGT3` |  |  |  | ✓ | ✓ | untested |
| FAST | `Xs58AdBQTkqkejRvfMrGMQMML1m5xMQKVfKgPmqNhwg` |  |  |  | ✓ | ✓ | untested |
| FCNCA | `XsccgtwEgwSxTh553v8iVLxNUrbHJfdnaJUjxgZfr48` |  |  |  | ✓ | ✓ | untested |
| FCX | `XsT9Z9BYM5Bp2JAuKVgw1XLdENGyvQwC5C2gAuzeKyY` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| FDS | `XsMQfkLnhK1ERGibdgGDHFaSHB8ETDtMiC5TtVZKMAv` |  |  |  | ✓ | ✓ | untested |
| FDX | `XsEmsxmtT12GBiqtvTxoNaipTBNEdUs6oq7pwHFHTb7` |  |  |  | ✓ | ✓ | untested |
| FDXF | `XsVT5d6jAm7dTcwz9o5jCUVrpdd1t86WLf4U7wb9mxs` |  |  |  | ✓ | ✓ | untested |
| FE | `XsLpCFJxUb43H6da8YzrS4j79wuddw8Z4GETup7hKMc` |  |  |  | ✓ | ✓ | untested |
| FERG | `XsfdW27Z6gk5otDjYw5R2ad7PP1dKoR1Qx2ayurRBGc` |  |  |  | ✓ | ✓ | untested |
| FEZ | `XsbZDdYJKxEBQASz4KBj23NRgymXw2NK6mbNQ6PYhC7` |  |  |  | ✓ |  | untested |
| FFIV | `XspZSVf3tmPqV7QXqNzCjmvv11nnAtQ4n4YwPxykt3U` |  |  |  | ✓ | ✓ | untested |
| FGDL | `XspurdrAqbRJMQfAUEfh88QxE3XbSWxQGu3GneJR6e3` | ✓ | ✓ | ✓ |  |  | untested |
| FHN | `XsD9pjJdLHkbvk3hGF13Mq9nY5ELLeGbQAoeDLZcRY8` |  |  |  | ✓ | ✓ | untested |
| FICO | `XsiZh3X1uThVm4bNh8PzyXVNe3v11oS6v2DCGdkboUL` |  |  |  | ✓ | ✓ | untested |
| FIS | `XsTdkPyDNVtJYUjV7VhyZwtqQmA2Lg4DdTkRjYPD2gQ` |  |  |  | ✓ | ✓ | untested |
| FISV | `XsXU2DbkVLWPRBG3QEpEXCTKS8Jv8VCxkB7e7ThdyLC` |  |  |  | ✓ | ✓ | untested |
| FITB | `XsVsC5yPcJKdeuZDejjymo2KJTuE3zdXZoSVuTXA7qv` |  |  |  | ✓ | ✓ | untested |
| FIVE | `Xs7zvvE6QUtYmpMBrz4oWJexS7WSJPwJs7vQsvMCpaG` |  |  |  | ✓ | ✓ | untested |
| FIX | `XsPTVwrSE3MMZF1bt15vxM7NuuRHdsBJ7mtGW4cttHX` |  |  |  | ✓ | ✓ | untested |
| FLBL | `XsCZJYnCmjs5cYZDMLVxVzvMy5AK2oqsWpobS6SYno8` |  |  |  | ✓ |  | untested |
| FLNC | `Xsc5BxL1ucvrQNXZqW3CT8M9gWTko1LPSLLkSVzGe9h` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| FLQM | `XsZdwvwEAn7KH8bCCo8AkxJmSm4MbaRxcDeh9Gt2VTF` |  |  |  | ✓ |  | untested |
| FN | `XsJ6W21MaWMQCqhRLbLTD82427vcMVzxULkomGRg4gJ` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| FNF | `XsPH7DxK5rGBdoFSSCpU6HgJZp1mKpRTVnsKQUN1j8B` |  |  |  | ✓ | ✓ | untested |
| FRHC | `XsCKGVtLBwZ4Z264jSPgPxzm3w6Sm3UkKv5WgHd3ike` |  |  |  | ✓ | ✓ | untested |
| FSLR | `XsSbcq8MZso4DLAMgtRKjzCvgozdh4sje8PLj45kxJZ` |  |  |  | ✓ | ✓ | untested |
| FSML | `Xs9nAeuqjogYHy2UfL6jYqGmM5MPrRjuz6UYk8H79mZ` |  |  |  | ✓ |  | untested |
| FTAI | `XsX857TxHhoS3CbRt58me2xx8zcAn6n5kMJScZKrHJa` |  |  |  | ✓ | ✓ | untested |
| FTNT | `XsWrVR5F8eUgoienkVAQLwjvtzEAUoWWcwhcDzu3qRX` |  |  |  | ✓ | ✓ | untested |
| FTV | `XsvL1QcWfqpUM7CQzcNsicatBTZK2dgJRTor3SHUXdD` |  |  |  | ✓ | ✓ | untested |
| FWONK | `XsDum7DWP825ChLAhSN5NYBpoCUsHJJdRKTPseA9VxR` |  |  |  | ✓ | ✓ | untested |
| GD | `Xsgk6nv6V81zQms4mcvUiEtLDdVueXfWPRCaxayqkSN` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| GDDY | `XsZLNUcjAVzNSbU5Z198ngop2mmoinZnw5ijBeMgWhW` |  |  |  | ✓ | ✓ | untested |
| GDX | `XsVRhRg9eRE9PrsoPsAt5Mifa8mfjm9R3vdw6orp54j` |  |  |  | ✓ |  | untested |
| GE | `XsfsBjSZoXXKJsxoSt8TyLYsjhBAKFaDPZTCQbFRirP` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| GEEL | `XsxsXLryvGn9xUBvkzcjNLR9C1krKy8YEySN7yVEyme` |  |  |  | ✓ | ✓ | untested |
| GEHC | `XsQoxoLVogLGYRRRcFwjdcFQVLxFpCuYfDtvh3vJ2Ft` |  |  |  | ✓ | ✓ | untested |
| GEN | `Xso2H7vbDS6HVokLUecSG5GvWAZXjH7PEHAH9rAYXUP` |  |  |  | ✓ | ✓ | untested |
| GENTE | `Xs8q9nMs3HPqxpGqxRXaSrnVcMXPKkXzR9f9XT9doXG` |  |  |  | ✓ | ✓ | untested |
| GEV | `XswXzAsMV9kebQjCVtr1btvrQgQ7C4C9kKgH4QYAVzw` | ✓ | ✓ | ✓ |  |  | untested |
| GFL | `Xs7pKrTAgPBaXjiZbGm8QQK36GRRX1Vsh7pTndjhxng` |  |  |  | ✓ | ✓ | untested |
| GFS | `XsrTYnfAtuMDpQQgZtpQZreJWtjaRnRCTBeekcQi8AS` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| GGG | `XseQK4PEeLfxY7HgvuSiawFUL5gfveK2maPMV9Ma8qv` |  |  |  | ✓ | ✓ | untested |
| GH | `XsJwJiZkwUTaZE1q2J1hX6YTGv3xRdZGtqan9a2VsYW` |  |  |  | ✓ | ✓ | untested |
| GILD | `XsmAFboVqfDwGPgXfd7oCunvYAYSzzkuKE2BDRzwjGy` |  |  |  | ✓ | ✓ | untested |
| GIS | `XsKfQxVh7wasRmzPQEs4qvnmayt5KTX1CqvQdJ8XcSJ` |  |  |  | ✓ | ✓ | untested |
| GL | `Xs2yt21rb2HpuMxE2EBHpcfd8mGdDPDysgWjVaDDR5w` |  |  |  | ✓ | ✓ | untested |
| GLD | `Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re` | ✓ | ✓ | ✓ | ✓ | ✓ | not 1:1, gold family |
| GLPI | `XsbohnBoBBbXg2scrDy9yzBqeXhNN53F5dcjwFF8XFR` |  |  |  | ✓ | ✓ | untested |
| GLW | `Xsg3UgvjxpUgV3WZx9Wt9deLx7qvKYp6ZLY6xMY2Dfq` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| GLXY | `Xs3c2aZenyRQwXjki5MDxJEJ2km27ef2rWQMFWx7QKJ` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| GM | `XsSFgHPgZgYNSuz1ttNHNp8zUBBMZGngFcMMfKPK6JQ` |  |  |  | ✓ | ✓ | untested |
| GME | `Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| GMED | `XsMkiaVUP5GkFCSJJGcun75edh1FSsLkCtDC3piGK2j` |  |  |  | ✓ | ✓ | untested |
| GNRC | `XsAiJ9xc1eBoVEz4npaJqySHLrpCoyo1oFfJJpYSXPW` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| GOOGL | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| GPC | `XsAB7oiJL94kURXya1i35Rv9ZoY9EoJSWM3dQ9mZp7t` |  |  |  | ✓ | ✓ | untested |
| GPN | `XsKbuY5Wyzz7Zzz6uxi69hHdxhrE53d746Sb1jBZyD1` |  |  |  | ✓ | ✓ | untested |
| GS | `XsgaUyp4jd1fNBCxgtTKkW64xnnhQcvgaxzsbAq5ZD1` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| GSAT | `XsNB1EjXVMUXGEC5X55DBG1ekMajZZvt9yAKzNmFhk4` |  |  |  | ✓ | ✓ | untested |
| GWRE | `Xs6w8aJhwu1d5jKbmScXoitaDEE7HWhyujhkELeh4B5` |  |  |  | ✓ | ✓ | untested |
| GWW | `XsSuZjygy7yrbyZJNzBj78ysrKDFMv11HrPPwBUE2Dn` |  |  |  | ✓ | ✓ | untested |
| H | `Xs5d6SH8HCeyBRkXNfoLWVnqgBT6tz8HnBoyJES3Fi4` |  |  |  | ✓ | ✓ | untested |
| HAIDL | `XssLkiDcsHvkTi2BXDLnXszTktNnTPBXFMVTvMBvVtb` |  |  |  | ✓ | ✓ | untested |
| HAIER | `XsW6LqAt4tGLAWu31ya4BQ9DLdpXeVEDSNZSqzbkYRC` |  |  |  | ✓ | ✓ | untested |
| HAL | `XsYq2q3UxkwdHmhxJf5wbuXfDWuy5mYP5xsDBVEDK8Q` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| HALO | `XsLaYaQLQfc9Z2Qis9gh6zebLbEoG1MLCrxD2wAmBBY` |  |  |  | ✓ | ✓ | untested |
| HAS | `XsRgwrznvMYsZ1i7ckfxjk6RWR4npsmZT3kqHuRfrva` |  |  |  | ✓ | ✓ | untested |
| HBAN | `XsuFbhEyBaWikFEfA3QM92rr9VVYm79Lip4cC5rnSp5` |  |  |  | ✓ | ✓ | untested |
| HCA | `XsJ5MSaKx3Y6bKEfmrRmovGEdRM53KWqEEHuaNUsQpD` |  |  |  | ✓ | ✓ | untested |
| HD | `XszjVtyhowGjSC5odCqBpW1CtXXwXjYokymrk7fGKD3` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| HEI | `XsjZ8V6qPBNbhXeFawPssBPUW8f7Sv39uxEnzxCboTq` |  |  |  | ✓ | ✓ | untested |
| HIG | `XsLw8Pw975zbR4QPQkAorVYM6qQq21jSztyDoskVz5x` |  |  |  | ✓ | ✓ | untested |
| HII | `XsqxvS2n4fRh41imCC68Z6NmDHk2SPXkGXrekg9o9kd` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| HIMS | `XsprHSJzwz3qmHcEf7j7WcUk6hMUL4sPLuAdWaSY1oh` | ✓ | ✓ | ✓ | ✓ |  | untested |
| HKCGA | `XsgLierNGzsEw1eziSPaKANRPfxXadZ6syo4WdGz2S7` |  |  |  | ✓ | ✓ | untested |
| HKEXC | `XsZQt7qW9vH5SWXZPsn1ZAybCSkq5MW2r6HGo891u1X` |  |  |  | ✓ | ✓ | untested |
| HL | `Xsp5pDV28HxQDLcoC24G6G2yCNBvVpPJ3DZCjhs7YNR` |  |  |  | ✓ | ✓ | untested |
| HLT | `Xs66hB4NftAJmu73aeBc6RXQC4DX4LwU4xvnfsz581r` |  |  |  | ✓ | ✓ | untested |
| HNDLD | `XsXQAtNjEzXfEotjKz6QQ9WHBdhbzMbPJDQfsc3UR7D` |  |  |  | ✓ | ✓ | untested |
| HON | `XsRbLZthfABAPAfumWNEJhPyiKDW6TvDVeAeW7oKqA2` |  |  |  | ✓ | ✓ | untested |
| HOOD | `XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| HPE | `Xszp97B7zgeyNUFkymHdxXp3Y5KTZ1rzd2bAL9TW34t` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| HPQ | `Xs23PmjqLoJvcLJ2LyMzi17HmkFua1yZsmcxWd4q8Zz` |  |  |  | ✓ | ✓ | untested |
| HRL | `XsQMbNzqcJURkmjzmh7DMfhjPf7Effu5QS3fpBLtazr` |  |  |  | ✓ | ✓ | untested |
| HRZRB | `XskaoJotEKofUeTnxQfvoQuW2kbL53uvnDJqVXj7Gf7` |  |  |  | ✓ | ✓ | untested |
| HST | `XsYbh3CsZ4qCMcfPKEtHAYbePTywhwCkFvdN7Hx3bHA` |  |  |  | ✓ | ✓ | untested |
| HSY | `XscEuBenD5X7CMVdh6MKzTSBQLsKNqmsoLiXHrQMitH` |  |  |  | ✓ | ✓ | untested |
| HUBB | `XsCz2AUyFUuadE9zxfs7ywkbMvaQNeVTeNBK15L43Qc` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| HUBS | `Xs8sK7KXi6tWULhBq4a8197Ydz4zDdLxtKjK6gBF59x` |  |  |  | ✓ | ✓ | untested |
| HUM | `XseFxRyaaJixiAzKBrSZAAKSLMQKVYceUGadwUAsQ7L` |  |  |  | ✓ | ✓ | untested |
| HUT | `XsG5QyZTQnVSpsXRpD92K5ZGoxXjsmfTyx7fW7r18DV` | ✓ | ✓ | ✓ |  |  | untested |
| HWM | `XsCX8NnXq3qx6zUxXxWwjV2yQnGc9C5y6UyXvE6RG7r` |  |  |  | ✓ | ✓ | untested |
| IBKR | `XsTS8D9tBV6oQRqkixzNCThctMwFzxScetp4BA9ByTK` |  |  |  | ✓ | ✓ | untested |
| IBM | `XspwhyYPdWVM8XBHZnpS9hgyag9MKjLRyE3tVfmCbSr` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ICBC | `XswoSyxJ3NayixJFM4y7JUNL8CFDrL68oUw7nr3Kbnz` |  |  |  | ✓ | ✓ | untested |
| ICE | `XsG6o69zE7mQCeFf6utyMx9Q89cJjGV4vTwi3wFHrkN` |  |  |  | ✓ | ✓ | untested |
| IDXX | `Xs2AVjDnFK6ShEvX6QfSFodHpy8znSBhimB4kvTFTa1` |  |  |  | ✓ | ✓ | untested |
| IEMG | `XsFnZawJdLdXfBSEt5Vw29K5vdBiHotdPLjUPafpfHs` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| IESC | `XsepazYXhizTmBmiZWfGwFnyUUSepwzQkLRgQyBp2Zg` |  |  |  | ✓ | ✓ | untested |
| IEX | `XsYoSPpGDGNwgn5HDxgwFxbcrsf8Xjr4Lc62j33JjfK` |  |  |  | ✓ | ✓ | untested |
| IFF | `XsXhUW1Mcpff3vCZWb7v3USU5Zpg1nvFPyfzF3XD6NP` |  |  |  | ✓ | ✓ | untested |
| IJR | `XsyZcb97BzETAqi9BoP2C9D196MiMNBisGMVNje2Thz` |  |  |  | ✓ | ✓ | untested |
| ILMN | `XsahzH43C2rZpZmYX6eCm2avkeYCzntC168xPdqrDzi` |  |  |  | ✓ | ✓ | untested |
| INCY | `XspemH4yD2PcDuZP4g8whQEeve3jrGbX331ksyaR9G3` |  |  |  | ✓ | ✓ | untested |
| INDI | `XsHYm9cRdEJoogpxDSZVDa4g19fKqUFXWxKisLpEuVm` |  |  |  | ✓ | ✓ | untested |
| INSM | `XsR6i1PnDGCbiV1KHsiMBdKz4MuDgpWHr3QSwC7zNMz` |  |  |  | ✓ | ✓ | untested |
| INTC | `XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| INTU | `XsfodJMz7SyMNsSgATVDcbuMiQDqQoAiRTL1xuyHNUn` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| INTW | `Xs7zs57saNfGWUn3h5d2rFxxs43uVqzAY7iQVPHFbwE` |  |  |  | ✓ | ✓ | untested |
| INVH | `XsQFmCYjvPGgqYYAth5zNhW8NSCabdamgM1kXMorJs7` |  |  |  | ✓ | ✓ | untested |
| IONQ | `XsqFgFeprZEpayi92MTQGheZiNFmTi2TRJRmrHjCzMx` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| IOT | `XsriZ58QT8GfKLep8Vof8oMGq3P9qPhowG8NfyLrLzQ` |  |  |  | ✓ | ✓ | untested |
| IP | `XsS6AVyq5YpDA5yCUYuwxvkk5hvKvFxAt5tUJik9Y5H` |  |  |  | ✓ | ✓ | untested |
| IQM | `XsGqU2JhofxjZBBhuXAroJGdiyZdvbx64tPx1Mu6DVK` |  |  |  | ✓ |  | untested |
| IQV | `Xstzb2X8HbtJVUephHsF7XknnwiBRYMxWoLyfUBWaoC` |  |  |  | ✓ | ✓ | untested |
| IR | `XsWx5RzivC8d5XwnLiMcgQqqhXiDnrTDwFCDap1o6NW` |  |  |  | ✓ | ✓ | untested |
| IREN | `Xshh1dRsnxatP45yBfrzU9MrvrFCvxHQGTrWjgdA81E` | ✓ | ✓ | ✓ | ✓ |  | untested |
| IRM | `XssP4Vb5pahDsdKUXy74gD34DzotHCYKGXegd1KHdiA` |  |  |  | ✓ | ✓ | untested |
| ISRG | `XsgBcHP3frsQGHr5EoDdoPZMANk52Y4JPg5BYx98NwL` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| IT | `XsfNvqLMCuDnxbtV3BhTm7ckCra1NpCVmokKHpvF9j3` |  |  |  | ✓ | ✓ | untested |
| ITA | `XsXoAR52Q2NYFkYiNqhCq4FauvyA1tdRsrmEYNf9fuh` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ITT | `Xsva3qbt1TDUgQPnU3vVDasaPoUHXPU9FjYXzEUYY8G` |  |  |  | ✓ | ✓ | untested |
| ITW | `Xs7NEcjqek7SN135xwSafr721njNVyenBdd7NDG2cYo` |  |  |  | ✓ | ✓ | untested |
| IVZ | `XsM5qDSyGiTVyHoi2VixmaEacByd3UCUoWtNhEqsyoH` |  |  |  | ✓ | ✓ | untested |
| IWM | `XsbELVbLGBkn7xfMfyYuUipKGt1iRUc2B7pYRvFTFu3` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| J | `Xs2ry2jjmvy67pYFweVbdeoPPRdUjnbBEubtXguWbXK` |  |  |  | ✓ | ✓ | untested |
| JAAA | `XsEYQJtVa51Ww3y28jV1FwheMgmDj8BpxYiCPThcLWW` | ✓ | ✓ | ✓ | ✓ |  | untested |
| JBHT | `Xs5CSFf663gjowEA7ANX8ZhPe4AkLWMqLbriVu1JmUV` |  |  |  | ✓ | ✓ | untested |
| JBL | `XsnZQ49Abxr3RJgRSxYd4azhUg4MQVT3amiyaq84oA1` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| JDHLT | `Xsaax31N2dJnKtkDbbJfvdYgz1zWmgx3xaYf6yjNuWx` |  |  |  | ✓ | ✓ | untested |
| JDLOG | `XsrGQPAF78mZRdnYK9U7m9wR93h3zpToVGv9yAuQUzf` |  |  |  | ✓ | ✓ | untested |
| JEF | `XsWiS1zCUByB7TkvLQcxbHW4wLQ45vm1Uqg9tkk81ur` |  |  |  | ✓ | ✓ | untested |
| JKHY | `XsQpEG5WPyZ5Pkno8mHrDXNfYNdeCUkgUEQcaHAQQ9g` |  |  |  | ✓ | ✓ | untested |
| JLL | `Xs8YQm9hLMTcTVSdPwBDLTFLpbcyxYBG4SGPXRp5s2y` |  |  |  | ✓ | ✓ | untested |
| JMKE | `XsBeB5z2oA2fvaVim3rRbqHV4Cxxz9nNCjqoUtFooXY` |  |  |  | ✓ | ✓ | untested |
| JNJ | `XsGVi5eo1Dh2zUpic4qACcjuWGjNv8GCt3dm5XcX6Dn` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| JPM | `XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| JPST | `XsCAXu7xTaZMG9b9KJhNWYapuvNjxPuE4SysZq8uvMq` |  |  |  | ✓ |  | untested |
| JTGEX | `XsMotTTUju1CZRh88eCRM1Pm6f91qHh1kbmaBYdS85b` |  |  |  | ✓ | ✓ | untested |
| KDP | `XsdvuTpWkg6TSzpGJrdEwUwtWT7UrUzMxYTLhUZs9s9` |  |  |  | ✓ | ✓ | untested |
| KEY | `Xs5GgkWgze4XgU7NC5iXJqvbGufxQBJKH5JRN2MSPWQ` |  |  |  | ✓ | ✓ | untested |
| KEYS | `XsXzXSMoSdF3gczdPhECXHN3TwfkUpNkthUvpEJVbDn` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| KHC | `XszMPpjvc5nyynUGktkn7JkqkfFYxunE29Rxi4Vo8C5` |  |  |  | ✓ | ✓ | untested |
| KIM | `XseurSPz9hnmd6k1eQT52a8QC53QcoCoD4qVbPmWzCC` |  |  |  | ✓ | ✓ | untested |
| KKR | `XsTd1xJRAwAddguKdxYPGoS3qhctGsJb1ue4Rm6URFa` |  |  |  | ✓ | ✓ | untested |
| KLAC | `Xsw2uU1i8tHjbgstUbtt3m6kg7BS7AgG5aj8z7ddmmN` | ✓ | ✓ | ✓ |  |  | untested |
| KMB | `XsNnfg6KXzaRsH8PE9T9YEahq3MQpSZ3dQAa4hcL1SN` |  |  |  | ✓ | ✓ | untested |
| KMI | `XsQxeWjN2M3Spr5YHRQiM1oQ8fgpJWtdBdg1E2ZrjFg` |  |  |  | ✓ | ✓ | untested |
| KNX | `XsUyRqfxY2XtFvP99Lkn2DDWtxNNAY6w5CVDu1F68G1` |  |  |  | ✓ | ✓ | untested |
| KO | `XsaBXg8dU5cPM6ehmVctMkVqoiRG2ZjMo1cyBJ3AykQ` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| KORU | `Xs2LakxmT2YycpcxRDCJ7crPbFf91JKdAAWnfzANFmt` |  |  |  | ✓ | ✓ | untested |
| KR | `XsHyXCSuYHca6SxpSLb2taKiWkoJA48pVcnqyFguHf5` |  |  |  | ✓ | ✓ | untested |
| KRAQ | `XsAiRejKuvLAdq9KtedrMSrabz7SWdzKoVK6Qgac1Ki` |  |  |  |  |  | no source (Solana only) |
| KTOS | `XsssrKt95uWKWRbDdbCeMubD7iiD74NqiXeNL1p3Gaj` |  |  |  | ✓ | ✓ | untested |
| KUAI | `XsD9Zgip86m52ob2c9MNTtDVoin1KmgdCNUCCDwsEPF` |  |  |  | ✓ | ✓ | untested |
| KUNL | `XsxnZRxni2PYV3KTmfqJmZHFK1z55DV4pigWDuMZH8i` |  |  |  | ✓ | ✓ | untested |
| KVUE | `XsDDkXqF1sr1ixW4Y93Geqfd2LbrWxokCjQf9poGN3c` |  |  |  | ✓ | ✓ | untested |
| L | `XsUn5iqqryPGjArLc1FWnzaquVsCjTPciXQGkRyWfho` |  |  |  | ✓ | ✓ | untested |
| LAMR | `XsqZyeL1GGWZzMQ5hh3KckQnXNt3Yt96QHBUdiJSoFS` |  |  |  | ✓ | ✓ | untested |
| LAOPG | `XscTQ6FeMPkhTuhFsrCZRn4fBmGsvqnFmPKfbC9B24g` |  |  |  | ✓ | ✓ | untested |
| LDOS | `Xs5VFGqt7aQ3Dykyk7A4NFL9K2z3x2BAnEDzvokY9Us` |  |  |  | ✓ | ✓ | untested |
| LECO | `Xs7wdJdbcu1oR36AvumDgFLPiHmhpF9GEHQT6h16zAf` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| LEN | `XsHjfVcciZyPmujpSYXKGyQZ3k4yyzxnUXE6CYdZ3AD` |  |  |  | ✓ | ✓ | untested |
| LHX | `XssE4tb3kc3f5V5cRL6dsuffP9wDm915W4bAsyNf62A` |  |  |  | ✓ | ✓ | untested |
| LII | `Xs4MEQwg4mtEjAbtBzKsmrDccxX64Y4emF2yJptPJ3q` |  |  |  | ✓ | ✓ | untested |
| LIN | `XsSr8anD1hkvNMu8XQiVcmiaTP7XGvYu7Q58LdmtE8Z` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| LITE | `XsexQ9qqNbDkLE6XwCN9ceVhLo8Lxc7UheVR6eBkKyo` | ✓ | ✓ | ✓ |  |  | untested |
| LLY | `Xsnuv4omNoHozR6EEW5mXkw8Nrny5rB3jVfLqi6gKMH` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| LMT | `XssULacY8D3z3a8HoQuLid8wdJHcZLGpSST9MkNFzox` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| LNG | `XsYLZdcMYST418xZhTV6KaHqr8BWqaKS3J45ywqigF9` |  |  |  | ✓ |  | untested |
| LNT | `Xs1WFZQyEwCZwEyZHRxTzd2KoEoa6MVfv2aZeAc2HXK` |  |  |  | ✓ | ✓ | untested |
| LOW | `XsixDLxXcKZBcRBddYiPZjB9FJcKMTLd4B7VBeKo3pB` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| LPLA | `Xsk7doh3Qsz51GJdGFUdXcW4PFSKgfj1KGMy6jjbk6J` |  |  |  | ✓ | ✓ | untested |
| LRCX | `XsSN912SN4Whn2xn59vWZHt1uLbw9WnoNGp5MigmHFf` | ✓ | ✓ | ✓ |  |  | untested |
| LSCC | `XsjaZAWtPNA1ZWqbPZxaDWtx1h9L23ucmRquwuSHQuf` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| LUV | `XseRUafvQDXZSddDFpsXQPBNggurszyztkh4TEnvEuM` |  |  |  | ✓ | ✓ | untested |
| LVS | `Xs9bwo2tkrKRJxr9787rKj2bKcQUMFNtbzruYTrxdst` |  |  |  | ✓ | ✓ | untested |
| LYV | `XsFU9pEZTmFTwGowKZkVtagbF5ivCJ4WTyPEZrzVFzY` |  |  |  | ✓ | ✓ | untested |
| MA | `XsApJFV9MAktqnAc6jqzsHVujxkGm9xcSUffaBoYLKC` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MAA | `XsUGoD9Dik1iNBgsjSzdjt7psrGgWpQ29DQr825e8Le` |  |  |  | ✓ | ✓ | untested |
| MANH | `XsvSL6VixgcGgaPDBuHEyTfmR798Q4tdg2sCtwvev4M` |  |  |  | ✓ | ✓ | untested |
| MAR | `Xs85zRMSv4KTRqSNjZSFWgEXEyb3esxUBzhTj377DH8` |  |  |  | ✓ | ✓ | untested |
| MARA | `XsguBZPkM9BDmxspmWe29EmrYZBv21ENcC27Pqh7grB` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MAS | `XsNZFvmZv6zEeAxgF5L72Nt6A2K8Uo6u7aRDLm7Smvc` |  |  |  | ✓ | ✓ | untested |
| MCD | `XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MCHP | `Xs9GioXYhWaR1Pt7HLiNRgkHynWdPPWcdZWdUCHkZNj` |  |  |  | ✓ | ✓ | untested |
| MCK | `XsnoiYFyBemVokJpx3ddt6mPB3v2HepSevRLXSfj3Y5` |  |  |  | ✓ | ✓ | untested |
| MCO | `XseTVygt2sUPQsfYbYVMXzV1AeMRE6Usj9DEWwStMe3` |  |  |  | ✓ | ✓ | untested |
| MDB | `Xs12gqhuCeC9gpUdN6uDJQfpyKNf9Y4uK2TKY6c7NrZ` |  |  |  | ✓ | ✓ | untested |
| MDGL | `Xs6hbDwJ8wr1zoxLusdhY2Vxjfz5C2doLVgZdZGRqvz` |  |  |  | ✓ | ✓ | untested |
| MDLN | `XsxaiepK535fVqavwRvJVTC64KaCLTtCgQT5jpR3rJt` |  |  |  |  | ✓ | untested |
| MDLZ | `Xs3hGRD2NSyUUC1fjK5gKe8hXQgLoqxjR5WtYL1NBbg` |  |  |  | ✓ | ✓ | untested |
| MDT | `XsDgw22qRLTv5Uwuzn6T63cW69exG41T6gwQhEK22u2` |  |  |  |  |  | no source (Solana only) |
| MEDP | `XsPdH3m4B33ZaRS5saL1XGQnUVYsx1yyEyAxmNfcpCb` |  |  |  | ✓ | ✓ | untested |
| MEIT | `XsLvCfSnXJjoVaAJENHxKRzCZaWJpyVQQfJgkHp9oXM` |  |  |  | ✓ | ✓ | untested |
| MET | `XsGhGG2TNXuJLFL5q7pAomKtMVc2YvVqs4G1hyBZLfw` |  |  |  | ✓ | ✓ | untested |
| META | `Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| METC | `Xs2UKGPTD9S19rXkSqwJ6ufxAtuCU9Ww3wQumk9MvCn` |  |  |  | ✓ | ✓ | untested |
| MGM | `Xs2hW1n8cBJAKUtDxZjJtFZBaxqTwczJY6n6XY8eV4o` |  |  |  | ✓ | ✓ | untested |
| MIXU | `Xs85byjTdWv5Z3YpUqyJjeRaZsxQDz81skYjQKdPDZc` |  |  |  | ✓ | ✓ | untested |
| MKC | `XscRMWo5xvLxenVLxmodRqZC3UJwACXoxAEEGQzrzKd` |  |  |  | ✓ | ✓ | untested |
| MKL | `XsE44zHnRJVdk5vRpy2YvUPbbg4caoxihL8EKDatiCn` |  |  |  | ✓ | ✓ | untested |
| MKSI | `XsVDmkYEQ3wwLkXKdkRmic3HroSbReejAcnY9eNmrRW` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MLI | `XsikuTgNGjzibezDk9u22QGW8zQaGWyK61vN4gQE4Dc` |  |  |  | ✓ | ✓ | untested |
| MLM | `Xsvi61uutcLdAsa5NxJ2c9geLgzUFM3tMtpJ44eoegt` |  |  |  | ✓ | ✓ | untested |
| MMG | `XsfLyKBQbxGQu7jQk37Ev55Sb9hxfbiHxX7X3msqHTs` |  |  |  | ✓ | ✓ | untested |
| MMM | `XsTEo8W2L8JprN57bmJgatDT84z57ReJYizr5f32BfP` |  |  |  | ✓ | ✓ | untested |
| MO | `XsztStxbbGZE63p8DyD8YCpzyWFJwwy2PNcyaf3cZz8` |  |  |  | ✓ | ✓ | untested |
| MOO | `Xs72K1Ta1D5ccNy3RzSyQWGgZywWvphX78pL8WBk1Bo` |  |  |  | ✓ | ✓ | untested |
| MP | `XsFARXCfXKCdu6BxV2WACBt3Dk88nxLujoqPzyyBib9` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MPC | `XsyqGLaBLmGCZstuUrvo7iWhJkZgg4KEBtcxVFBsYSg` |  |  |  | ✓ | ✓ | untested |
| MPWR | `Xs9YEeNWvRwWK4wPHPaitx9mFyfU6hbUY539BLJSHCN` |  |  |  | ✓ | ✓ | untested |
| MRK | `XsnQnU7AdbRZYe2akqqpibDdXjkieGFfSkbkjX1Sd1X` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MRNA | `XsViHjyRbiSBskjizb1gszGTmZqtAH8TuqwJ7sB5AcP` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MRSH | `Xso2JLSTXQjpDXw1r7ZxbC2JCbB6iLGw65kUzQvgTwH` |  |  |  | ✓ | ✓ | untested |
| MRVL | `XsuxRGDzbLjnJ72v74b7p9VY6N66uYgTCyfwwRjVCJA` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MS | `XsUucbjDLYbER4WNNffn1eQ9cDnAcFVfLgSZeLHPDZS` |  |  |  | ✓ | ✓ | untested |
| MSCI | `Xs4BPW5YU7RsXMmCt6CyDphWH3YLtyaXDXEzZDmj33G` |  |  |  | ✓ | ✓ | untested |
| MSFT | `XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MSI | `Xsa1gZ38panjmJwh6cr9QQ1YpRBEzVfxrykWSsiWvJe` |  |  |  | ✓ | ✓ | untested |
| MSTR | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MTB | `XsMXtu6uQkfvxCYURytUcQvhFCoqvphtoezVBh42CfZ` |  |  |  | ✓ | ✓ | untested |
| MTD | `XsXb7oGeK1N5Jk9mm9VD4ZQrXsu9NULWP3C3n7hhDWp` |  |  |  | ✓ | ✓ | untested |
| MTRCP | `Xs1myeXT9eHk3aAX2xa6LZ5AWBJzsDLc5RxT9zYqWAm` |  |  |  | ✓ | ✓ | untested |
| MTSI | `XsGkSoEbLmqH2GCixj1MdGYHDbRaJdgnnDPrYhMuLxA` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MTZ | `XsvBVwk5d7eU6prsSxHJPu2adEm5q6wx55mbhov2UnF` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MU | `XsQLZycSZ7QnBBdBXQaTbQdiUcbRqjNJgyBGAMzhHav` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| MUU | `XsjZG9MgLMECjzSSxq3G7rabDceoaDqhN4C4zwce4i8` |  |  |  | ✓ | ✓ | untested |
| MVLL | `XsVEdRV17tPdXHamAi6TVFjyeSRHnCjdY5GXqAaevuk` |  |  |  | ✓ | ✓ | untested |
| NBIS | `Xsii5eERa2sKFyTHQqdYxpxL5xoUSLVurzHeqBEMBho` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| NBIX | `XsCNTvYMAHYPuHc5r9WWhnYfvAZMLLsguv2NBLs8wrx` |  |  |  | ✓ | ✓ | untested |
| NDAQ | `XsLSwcujLXXgCPZWPZKRsksbZrWupPMNKmg6A71g2Ba` |  |  |  | ✓ | ✓ | untested |
| NDSN | `Xsgfrh1tHEuCADVTuQDZiG5LRcVYeEU1wKT3YKuucbA` |  |  |  | ✓ | ✓ | untested |
| NEE | `Xs4f5EbxL1bB89N7ADF7smF8fXxifJa3t6SexZufBWA` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| NEM | `XssuE11NLek5vAeHNS2Jm8PFvT4PE7dtnpZwasWTGDT` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| NET | `XsR3LAMkzuPP8DnfYaiB2grTWqkBVy286gjJVErK1bi` | ✓ | ✓ | ✓ | ✓ |  | untested |
| NFLX | `XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| NI | `XsC3CiuRAFKN99m2ye6q7xrYMx4NuBdr1JR2gVWgFLD` |  |  |  | ✓ | ✓ | untested |
| NKE | `XsGYpMvKbVt6ViHqRd7cF3s746dAMFBQWcC49hB9VVP` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| NLR | `XsTSfxoQry8okZoGMN5t6mExibDq3gA2NDLJeLztX7E` |  |  |  | ✓ |  | untested |
| NLY | `XsFzP3jXofHQ3GKPYoGfFNQQKyWrNcPR5Xgg8gbk9op` |  |  |  | ✓ | ✓ | untested |
| NOC | `Xs1eyZcwrzzYW3hDjfpm7PiJrC9RyFszsHpqfTeUTCE` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| NONG | `XsZHUEeic6QiGEadqCje2zBoTxNX1B3857CjYkMEfuw` |  |  |  | ✓ | ✓ | untested |
| NOW | `XsBnEFd2EtpwBRNVfN8qLZcVUnuqXRaGCSEEFChLfxL` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| NRG | `XsZ9qtReiaokaUfW3bEUx2AU4Zmcjk9Y95nEtFMqEXn` |  |  |  | ✓ | ✓ | untested |
| NSC | `Xs4UsCDQKKJqHjidgoZBHUW9emLD4njpLPsYesp4ZpZ` |  |  |  | ✓ | ✓ | untested |
| NTAP | `XsjLc87ewHkMhsxhNRLy4TZFG64ycoZb23hLc2WW7iZ` |  |  |  | ✓ | ✓ | untested |
| NTNX | `XsLsExw7d7cjbN65GwQzS7HaDxCtyE3rjywcNXqEtxL` |  |  |  | ✓ | ✓ | untested |
| NTRA | `Xsw75QJKjhyvcSFDnqrtXn7amNhCVgeoaoo3rp3sDak` |  |  |  | ✓ | ✓ | untested |
| NTRS | `XsRx9hY5BQWniDRahLNtV4uyyvQcnaRgrqw5ops842R` |  |  |  | ✓ | ✓ | untested |
| NUE | `XsvdeDvbEfZkvfEUixS9SydEfJopFFD6NJjXZN1haYr` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| NVDA | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | ✓ | ✓ | ✓ | ✓ | ✓ | Ondo Solana live; Ondo/xStock Ethereum quoted |
| NVO | `XsfAzPzYrYjd4Dpa9BU3cusBsvWfVB9gBcyGC87S57n` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| NVR | `Xso5KNztULjrQZQGzJQEwGcwBLSneMDpunzSu243URw` |  |  |  | ✓ | ✓ | untested |
| NWG | `XsVXnJqySwKVHq3stnK9EKc7criyv5oTtrid7UJQot7` |  |  |  | ✓ | ✓ | untested |
| NWS | `XsbsXGj6Y3jVNh4MYH7khsonL14iYBUHukSReovZoQP` |  |  |  | ✓ | ✓ | untested |
| NWSA | `XsGXehA4smaWwx8yKTgdY1PQvaUxNQyT9gEt1Ly2B5f` |  |  |  | ✓ | ✓ | untested |
| NYT | `Xsfyi9JrpUDKaBZxgAAFS7wWV5xeTUkYoQLs3SUiYdg` |  |  |  | ✓ | ✓ | untested |
| O | `XsyMphR2LaL2YBiorsZYFhdN96xKTSi64L3pmiAHLc3` |  |  |  | ✓ | ✓ | untested |
| OC | `XseGSSi5kLz8eR539iXZ6tLz6r75UaHTQ6CHYkPjs9F` |  |  |  | ✓ | ✓ | untested |
| ODFL | `XsuEQKUzuiMTMwFTm6MHBeTvknFU585gwu9u4CNKjQD` |  |  |  | ✓ | ✓ | untested |
| OHI | `XsAeqdosiRKYKtYRLoao2TQDB16yLRP82MCwd7ibVuH` |  |  |  | ✓ | ✓ | untested |
| OKE | `XspDMNC416uCcUbngqyAwzk1phuRYdmm6AMsWo3EHd4` |  |  |  | ✓ | ✓ | untested |
| OKLO | `XsJb1p4Ks6VFggq68JyMz7S3kdRfkqh4wA6EMyxi4DD` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| OKTA | `XsHXJXdfTGnrfygPVvnzb7xdsUiunEQZew7teAyvosL` |  |  |  | ✓ | ✓ | untested |
| OMC | `XscmXyJYjYbGNhxQsPjjRYsEwscg6uPFJzR6Af7Qi18` |  |  |  | ✓ | ✓ | untested |
| ON | `XsTzZxvfNdVESw8oEn7cNPnfQ4SGk7ncBSezfU6dxa7` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ONDS | `Xsgc9YTqdAH1GzDLBGQcScCMgkKsVBn4hBmqtNRospY` | ✓ | ✓ | ✓ | ✓ |  | untested |
| ONTO | `Xsu33VJj7s2tMUZfAQ8bbGgpDEnfXdCsKHSC4p6C5tS` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| OPEN | `XsGtpmjhmC8kyjVSWL4VicGu36ceq9u55PTgF8bhGv6` | ✓ | ✓ | ✓ |  |  | untested |
| ORCL | `XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ORLY | `XsZCRtj2wRfksr19c4Bf4L2WBB5EYPmr1nBQS1yXApD` |  |  |  | ✓ | ✓ | untested |
| OTIS | `XszGT2Jo6bZz2SZBmhPstvo2xSs37q67nUJS7gtAfvx` |  |  |  | ✓ | ✓ | untested |
| OVV | `Xs1b4xMzH16fHZuFUoXxni8THVafJ9t5dFL6kPUyG4k` |  |  |  | ✓ | ✓ | untested |
| OWL | `Xsnb4PjGtFsvTyp7HJNWfJLEbK6MoSZV8o7xMo3PuBn` |  |  |  | ✓ | ✓ | untested |
| OXY | `XsRNiTxDeRvxTEMTV5BC98N7cTZXxjNdLnudR8YeB2b` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| P | `XsqSsaDYsEAFwRwcwchPc9J1zX21VtHiXGJjFt5Ph5t` |  |  |  | ✓ | ✓ | untested |
| PAG | `Xs7waUdcn1ZQDsuFmHRerWEEazRHoWWzWSa6aB7QjHG` |  |  |  | ✓ | ✓ | untested |
| PALL | `XsTTtPA5V19YwHKDv4xeVXNM6kdsQNJvg3MyWkRUckt` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| PANW | `XsQ6NfzzLH8nspjrB9X8R2K64Zz7Tnxqu12juDiMPMW` | ✓ | ✓ | ✓ |  |  | untested |
| PAYX | `Xsuo3Vd8T7MVAx3miKJ1beX4sGutzdL3GJsjk1yFbxA` |  |  |  | ✓ | ✓ | untested |
| PCAR | `Xs1rnpzumX77Zz3nVrRGbDYzTM4PM7vgvS4BLTG6ckQ` |  |  |  | ✓ | ✓ | untested |
| PCG | `XsPq3VY73br4wpgi2a4b3jAdvuhstpknXVJ2fA4vNmk` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| PCT | `XsyQipBmDKeSy78zCSMp4BY91Cd46Dx3q4eBoSqbBDX` |  |  |  | ✓ | ✓ | untested |
| PEG | `XsUytoK53kCKfXC61Dn3ZM8sjyVBUpScF111pfMG69U` |  |  |  | ✓ | ✓ | untested |
| PEN | `Xsbd5DQzyAjsjzZiLP3NYztwkapYQpPLBvYsnzyHscq` |  |  |  | ✓ | ✓ | untested |
| PEP | `Xsv99frTRUeornyvCfvhnDesQDWuvns1M852Pez91vF` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| PFE | `XsAtbqkAP1HJxy7hFDeq7ok6yM43DQ9mQ1Rh861X8rw` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| PFG | `XsChiU9gDeWj7HYrqioNUn8C81jaHZwegfGQdQXHnhd` |  |  |  | ✓ | ✓ | untested |
| PFGC | `XsTnXvRqrDisLoYpLDUowPx2HLhd6p44ZAbEKyGsL3g` |  |  |  | ✓ | ✓ | untested |
| PG | `XsYdjDjNUygZ7yGKfQaB6TxLh2gC6RRjzLtLAGJrhzV` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| PGR | `XsGDHfnSNxofQ2qXzcty9r4HB5HFszUCrQhjN7mbEcw` |  |  |  | ✓ | ✓ | untested |
| PH | `XskVc7XiWmSqvzbjhA2LqGHQhvBdBNfatfeTpNru6KP` |  |  |  | ✓ | ✓ | untested |
| PICC | `XsFRjWSNaDPz9nVYUsSky5dJKjN6W5JupHCHbNwg4mE` |  |  |  | ✓ | ✓ | untested |
| PICO | `XsioL5whfekeqi92geGL9hqkDWJ2XuDbXDcmBkJktro` |  |  |  | ✓ | ✓ | untested |
| PINS | `XswgfhwvyLQ6ZdNsrwBGkBVpqXzQPpDykCDBmiti1o5` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| PKG | `Xstq2wirnUgqHdMvvWafGVbdtg9y845zxAy7iVixkRU` |  |  |  | ✓ | ✓ | untested |
| PL | `XsMJtFbb8BwzQtck3oRXyAfs7SAPRuTXnSEDNd7BAVz` | ✓ | ✓ | ✓ |  |  | untested |
| PLD | `XsnXCL5FtHLHH1jW5Nknd5BjuazxnnkCAGR6fWPwPJL` |  |  |  | ✓ | ✓ | untested |
| PLTR | `XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| PM | `Xsba6tUnSjDae2VcopDB6FGGDaxRrewFCDa5hKn5vT3` |  |  |  | ✓ | ✓ | untested |
| PNC | `Xss1A59GFZcvyuTXLXMyYdJ7e9kpHq6AFKNjcVZ1rjA` |  |  |  | ✓ | ✓ | untested |
| PNFP | `Xs9pFT45PF5PH1hgwQ5fknXYWVZassVSq4spNswnVtR` |  |  |  | ✓ | ✓ | untested |
| PNW | `XsaZESJuX1EC73t54PmbirdQ5JHPHQsPnMB54bgZLp4` |  |  |  | ✓ | ✓ | untested |
| POPMT | `XsyQU594M51pbhveG89CPanCJHPJt1tjLJroKMeHrmm` |  |  |  | ✓ | ✓ | untested |
| PPG | `XsoCb51izF2MpU5XghroQDRxtJ2vtcMY9v5Mk1pqaBr` |  |  |  | ✓ | ✓ | untested |
| PPL | `Xs12SMK4MA7sLVS8eTged2pXns736u3qe2a1a9io6he` |  |  |  | ✓ | ✓ | untested |
| PPLT | `Xst6eFD4YT6sz9RLMysN9SyvaZWtraSdVJQGu5ZkAme` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| PR | `XsXh1W6QRHJBYdzVrngAxn4t4JQnJBYk7iM2S1hwqdT` |  |  |  | ✓ | ✓ | untested |
| PRAD | `Xsb9LAiNr8LAGa8G9Uo1UxoWKs43adKvhXTdTtFt7mo` |  |  |  | ✓ | ✓ | untested |
| PRU | `XsPhDoJMMgARN4eB8apaPNFUjVBKqx3WtRS4ddBwKVw` |  |  |  | ✓ | ✓ | untested |
| PSA | `XsBLm8wotoJMHjonHcr1btz9RwLa3EWjhtbs3DbQphg` |  |  |  | ✓ | ✓ | untested |
| PSBOC | `XsZDpnjZWLY4yN5FMgTg2GZSdH7ZpWuHPYsooTKXH6u` |  |  |  | ✓ | ✓ | untested |
| PSX | `XsYvZVxiNdjuHQQzdCmf4TMSTBgvarV2gLi2akooV8V` |  |  |  | ✓ | ✓ | untested |
| PTC | `Xs25CGQuYuoXrMMWUSxo9WmvnQZyFzBChaHbUPXzm6b` |  |  |  | ✓ | ✓ | untested |
| PWAHL | `XsQqMhANWwSjKHAV2rEN1yGaBRxSBRbFGxwzmfjJcBh` |  |  |  | ✓ | ✓ | untested |
| PWR | `XsLR2VCGNzYVLfJGEwwNZsRYDZBGyBnoQH5rPGvwodA` | ✓ | ✓ | ✓ |  |  | untested |
| PYPL | `XshWQWYVp5ff8CrAEsGmLVKD47nBWi3Ygn5v8wXK27G` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| Q | `XsqUtYxpP7o3b2yupu7WZ2bi9u68W7VHQTFNR36mz96` |  |  |  | ✓ | ✓ | untested |
| QCOM | `XsUUG8bjFN2KvzLTpzavvEKdAjMAeLTZiTeAQJ9uhvB` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| QQQ | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` | ✓ | ✓ | ✓ | ✓ | ✓ | Ondo Solana blocked; Ethereum quoted |
| QSR | `XsG3eLvLbHwYQP3r7tSznE6bEvcA2Ko1TpYwbyD6RQk` |  |  |  | ✓ | ✓ | untested |
| QUBT | `XsRJiWgqGJrDaidERfWfdZkaxdA4VPjVEqN6XFctpp3` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| QURE | `XsuE5LvQcc9P67iWVqsysQ84DBDRWssbiKnwY8JtwpL` |  |  |  | ✓ | ✓ | untested |
| RBA | `XsTCwtofQgx1SLYkouHvVg22beYhn1dmj1vtC3TUp6M` |  |  |  | ✓ | ✓ | untested |
| RBLX | `Xss5RAku5EH6UViFdvW7ss9xQjwQLsrs2opPMhb3k43` |  |  |  | ✓ | ✓ | untested |
| RBRK | `XsJRuk3Mn8wSkc3aTkG2oqxFJiZqC3YU3gmNZSFbLvb` |  |  |  | ✓ | ✓ | untested |
| RCAT | `Xs6yCfUGbkjcvivWr4crLR7pJGxEXspsuuUMhxNEEUw` |  |  |  | ✓ |  | untested |
| RDDT | `XsXEEJX7WoXfre8ZqYx1M1yXnEwd1Ww3YhvfESA2DzE` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| REG | `XsJzAzVt6H498zDafSaWj3htVDYQPmh23jUAM2Rt2qn` |  |  |  | ✓ | ✓ | untested |
| REGN | `XsWkTtvUXJgrvxvgGuHRRqk6iwDuviEQZw4uJFUUGgX` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| RF | `Xsk2PGWHCQweEwYWNqA72KbuUdNz518MBzHSaBDLowq` |  |  |  | ✓ | ✓ | untested |
| RGA | `XsFvsyP8i3Qpat1BK78Yjq3PsTNhD3SV5FHryJrWbHs` |  |  |  | ✓ | ✓ | untested |
| RGLD | `XsgiYbKzzyYzuxRj1R4E6rvfVccASCGepmWEMpJdFG2` |  |  |  | ✓ | ✓ | untested |
| RIOT | `Xs31mE5EiqjSHEaiX9QDKCN6NvSGCqpJ6f1FNq2wri5` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| RIVN | `XsoxDMY8s3ZV7zD4Yd87wAvURyxA8VXkd7w6HNuQkzj` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| RJF | `XsgQwodongKCYRux621fuQzxQRv3fyXQKyPzc2CJ7Ys` |  |  |  | ✓ | ✓ | untested |
| RKLB | `XsKSh3QDynp6oms9yHjZXbZo3pKzUBoqUFKPHS2g9Bh` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| RL | `XstJ1deKwoZVAzj1oF14s7g8ZPLumJKyiQXysym5duM` |  |  |  | ✓ | ✓ | untested |
| RMD | `XsjsQvjH8BEXCjrgNiVhmhFiYPcNRXGj262fDupfV1A` |  |  |  | ✓ | ✓ | untested |
| RNR | `Xs5m7mD1sRUu3ryXiYNDqCTd67hQVZRSro2zxxWqTtn` |  |  |  | ✓ | ✓ | untested |
| ROIV | `XsR5eHL5sXTwUckUcenkZyBdAkShFBcNDiYeecBMaCu` |  |  |  | ✓ | ✓ | untested |
| ROK | `XsnR8Rtrd8yFDGP3g2HwLdGiw58UcXjggXzgkL3pNYz` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| ROKU | `Xss4k5HDz8CwyNnbZixMs3XgaXvnMoWtpxeqzFK6wvA` |  |  |  | ✓ | ✓ | untested |
| ROL | `XsY112rrZJhJE1J1Z8BTSk135spPGHuGRCfnvr5pSdQ` |  |  |  | ✓ | ✓ | untested |
| ROP | `XsCbNmXqgaDVDTpXaATSrki9ATKwu1wzfhcYwPriMns` |  |  |  | ✓ | ✓ | untested |
| ROST | `XsPYJyoTnjc471VCHEERVBVrJ7xuQhDYWddPw6koNVV` |  |  |  | ✓ | ✓ | untested |
| RPM | `XsBGGtLnNqa87iTENkgtBV4itt6LNxz7osKS1nmnqTD` |  |  |  | ✓ | ✓ | untested |
| RRX | `XszxuQCqE72vU4ABTFDFwhs28AeSUHqzbWWVWDkhfYZ` |  |  |  | ✓ | ✓ | untested |
| RS | `XskVwPpXzyc9Fc4vqvHJ5v4ojMDWyjzcdPYTK8vFrUy` |  |  |  | ✓ | ✓ | untested |
| RSG | `XsUkTUDE9hCG9GLEpw3STiGuf58hYmpymiF3z1nPh3A` |  |  |  | ✓ | ✓ | untested |
| RTX | `XsN53tgjZA4QU8iuedPNHxxCbDqKcJqbrT1f8jBXzdC` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| RVMD | `XsCRJ3YusYCZ8ihZbmdao46y3ddSibxPK29UsitD9J9` |  |  |  | ✓ | ✓ | untested |
| RVTY | `XsVbwfq869bWTKpW95shx8woTpzVSmsbCEE7xsMqWQ6` |  |  |  | ✓ | ✓ | untested |
| RYAN | `Xsgyj7QR8RoPrkCCS2ebXwiASE69q2EvK5B7ppeKgBt` |  |  |  | ✓ | ✓ | untested |
| SAIA | `XsdzBn1wxCibSdDZgaaWqGtdvo2JSFueo2CwHnA69Lf` |  |  |  | ✓ | ✓ | untested |
| SAIL | `XscePZ4mjiXqyEVv9ZZPGbT6L86LqnYPEBE4ViKSt3T` |  |  |  | ✓ | ✓ | untested |
| SATA | `XsAxB3xLnt7xto5ChiSbVNHBoXcXzKuzS7FieiNYwtY` | ✓ | ✓ | ✓ | ✓ |  | untested |
| SBAC | `Xs3BuKwwLLSgKCKPBeSN5Wje5gP8McsHrt6pnqWzjhs` |  |  |  | ✓ | ✓ | untested |
| SBET | `XsEoih2x6nZuUjFwzGoba6MFmtzCkzW2c4YAm6baQbq` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SBUX | `Xs9gd8SGbYQn9kkUYQayn46BdqQbvvUshEF6ZpRAzM7` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SCCO | `XsQD8itHh5CdrWMiH8cZPB55KSATjdXsxcSJJ14YCFD` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SCHF | `XsWAnFM77x6YvpdaZoos79R12o4Yj4r7EVkaTWddzhU` |  |  |  |  |  | no source (Solana only) |
| SCHW | `XsK5U9qwT9ErPXnpgDzV9voTGASZbZnNTYTGVxCqPii` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SCI | `XsC3icNzi6x7cRA6hodAZQT5GAsxwGrTxWL5awu4gsn` |  |  |  | ✓ | ✓ | untested |
| SEIC | `XstGFYNtBmWaCk3MfbEeqMYYbUf2o3PTLJm7R7iYfGS` |  |  |  | ✓ | ✓ | untested |
| SF | `XsHfvLEUbto797whYCNiqoEGWSpWaRYoZWXJEBGgmsm` |  |  |  | ✓ | ✓ | untested |
| SGI | `XsU3RZd5ufTcCJneLjDhTrU47ma9ypnhXyvJACRZrTv` |  |  |  | ✓ | ✓ | untested |
| SGOV | `XsYD72ntjj7ZwoFDZCDmN2gamTcLpnywqvG7PQN5vCN` | ✓ | ✓ | ✓ |  |  | untested |
| SHAZ | `XshjhoEnkjn6T6f2oyzVrAnMFgixpvFoBp7KepdByJ7` |  |  |  | ✓ | ✓ | untested |
| SHEIN | `Xs8w8HvDjT1DxYeHzhSkRT8wYUahJB9kRC7Fuiic2Hf` |  |  |  | ✓ | ✓ | untested |
| SHW | `XsfgitU15HiJX9UJN2fhcpbfRr5P8XJXvC1nuJs3jAr` |  |  |  | ✓ | ✓ | untested |
| SINO | `XsUtvf2GurvELy5dM2cHVZHZ4ufkviBv6gjQFfKKHeL` |  |  |  | ✓ | ✓ | untested |
| SINOT | `XsgiiLos4YromwpmshTMTN6z3PSbD51HSn9k9xysujp` |  |  |  | ✓ | ✓ | untested |
| SITC | `XsLwAZXq8MyrkrdsfmPoRxrdQMvGjwveSK9Ug33uRku` |  |  |  | ✓ | ✓ | untested |
| SJM | `XsqtzaHCKV2zsgRYitGJtcecfmBkdJsdrpSXZgQryHE` |  |  |  | ✓ | ✓ | untested |
| SKHY | `XsnhgGRQwhExfS2bmWzR6EYddKGPRGDEjeJsatkmKqU` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SLMT | `XsPHkGBbztHCCe1RMhiAs7CxVqoghmyd6zDUfrbfVWG` |  |  |  |  |  | no source (Solana only) |
| SLV | `XsxAd6okt8y1RRK6gNg7iJaqiWNiq5Md5EDf3ZrF2dm` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SMCI | `XsMxAoJP47FQGLsVUvSS2QfBaHdNsd7DRU6nWRL8RSa` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SMH | `XstuBvLo7soZzj3beCCPonHpR3eUfPNSeQzw35Swons` |  |  |  | ✓ | ✓ | untested |
| SMOIH | `XswbKzrwuU9XaDu5w5xLXFwSwr9AbyusuP8SMYirr49` |  |  |  | ✓ | ✓ | untested |
| SMR | `XsrwdnwLHjVnyy7fgE2Pdwjp3czEm73jPjkSC5xzUBw` | ✓ | ✓ | ✓ |  |  | untested |
| SMTC | `Xs9bdUnLdSWjQWeEsy8cde6t2L7d3adDRKcH8H51Uwr` |  |  |  | ✓ | ✓ | untested |
| SNA | `XsKxGKYM3RsRvdgzAZXAh7HZiReynB5pxvoTLRMJiF9` |  |  |  | ✓ | ✓ | untested |
| SNBIO | `XsyeAGJ5CS1uDtDcnFaHTW3QCF5eL2CAt8vcrRBeAs5` |  |  |  | ✓ | ✓ | untested |
| SNDK | `Xswbpc8UqU6e1j9QZEWCjBMjyvz4twqD7PCy6j2e7jj` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SNDSC | `XsFRth3iT4KjYSzVvWpdeFhFjzdguCFiv3zMWJEodsF` |  |  |  | ✓ | ✓ | untested |
| SNOW | `Xs3QCTNpPWTFYRQ9yPv9gsvWKNJGk45UQ1bb1w7xznc` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SNPS | `XsfGN1hFHbigfAzUY1nLRjrECm3ohGzVcim5pMqgp9d` |  |  |  | ✓ | ✓ | untested |
| SNX | `Xsh64eWgeLab2YtKPRy15Zj7tXrUncjVwszGW9F5tWG` |  |  |  | ✓ | ✓ | untested |
| SNXX | `Xs3EFHHyP27EsAw3ftS8UFsN8kwkhFvbppji6bbkkPn` |  |  |  | ✓ | ✓ | untested |
| SO | `Xs5nNLYnMuwBTMQ7KnfCgfsDBa9WehDa1EZqzicarZm` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SOFI | `Xsipo31rLh5EqPMR2cArn6kVPAD83C6rxbmCrT9Wu5u` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SOLS | `XszuTk3Rr5HXpV7Nrfpg7KAZJfDccPAYLKBsRbLYRx4` |  |  |  | ✓ | ✓ | untested |
| SOXL | `XsdZDkoMdUb6iKDAKKappuM7C1Q2HmTqC8jNujbfmCu` | ✓ | ✓ | ✓ | ✓ |  | untested |
| SOXS | `XsCucuUESBi3ZjRxmjwUzGYuf6ZrtZDUvK6XhRA4RR3` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SOXX | `XsEsHeiNZf88sABxu74TPuXbQThdaQGdzPVZUBicjtQ` | ✓ | ✓ | ✓ | ✓ |  | untested |
| SPCE | `Xsgrm4D6VBTfDx5bs7GNdjtmWDgZ8V79r3YpsYwf5py` |  |  |  |  |  | no source (Solana only) |
| SPCX | `Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| SPG | `XsUXFEjcDYrp7NuzHtC88JLyirmnLpA8nde1e8eRxEn` |  |  |  | ✓ | ✓ | untested |
| SPY | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | ✓ | ✓ | ✓ | ✓ | ✓ | Ondo Solana live; Ondo/xStock Ethereum quoted |
| SRE | `XsbicvsCUHE9ja8gTsjzruDxQTKeyij94i3phx3NuNf` |  |  |  | ✓ | ✓ | untested |
| SSNC | `Xsq4wQVyggsJXzrjQK51M8bxK3duFaRegcX5Vxdbfcx` |  |  |  | ✓ | ✓ | untested |
| STLD | `Xsw7mKDicsyZ7dgSMfFxhX5nbgat3uG9V1nCxDy6Gvp` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| STRC | `Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH` |  | ✓ | ✓ | ✓ | ✓ | untested |
| STRK | `XsaQGz41BEQkS9xAB44uvUtuXcdLJAXEU1dogEzWMZ8` |  |  |  | ✓ | ✓ | untested |
| STRL | `XsHLmetWDLLqs613YVRnkUsEZP4V1FSA3gTt33Dc66Y` |  |  |  | ✓ | ✓ | untested |
| STT | `Xs6QWdM8Lgdf3gUfmhZfZDu8DKcoMyxjgyU46R28RUR` |  |  |  | ✓ | ✓ | untested |
| STZ | `Xs6eATub8cqKdztx4asCRFMSzMwtNqAUWiDaUPXxUtD` |  |  |  | ✓ | ✓ | untested |
| SUI | `XsWaSDd1S6YhQfsnTquL5ht2TGHe3mabeZ2Kvfpjsnc` |  |  |  | ✓ | ✓ | untested |
| SUOPT | `XsVpajrhXA4CffEm652abYSS2iDiKnLnarPYxaokYis` |  |  |  | ✓ | ✓ | untested |
| SWK | `XsNotS1p6BsTADzMaZVu14SJbuH9V4CYYyRZ8mn6WAQ` |  |  |  | ✓ | ✓ | untested |
| SWPRP | `Xsxr7Bmw3Sj4ib4RziMw3CZuFVfCUgFuXi4W5bbmrV4` |  |  |  | ✓ | ✓ | untested |
| SYF | `XsWMBE3QzwuS7pJET8GUyaGzjNJG49RToPBYWdGHUTG` |  |  |  | ✓ | ✓ | untested |
| SYK | `XshACd866qcdJYTotipkEHNKKnjDHJJkUciUxKVenE3` |  |  |  | ✓ | ✓ | untested |
| SYY | `XszobR4az4oYsssmwsFov326662q84g7UPXzRgrGvfS` |  |  |  | ✓ | ✓ | untested |
| SZIGH | `XsvkFi5zMUCQ9Ynzjsu2d5wcpTEZBW5ZRggHhDBUwRC` |  |  |  | ✓ | ✓ | untested |
| TBLL | `XsqBC5tcVQLYt8wqGCHRnAUUecbRYXoJCReD6w7QEKp` |  |  |  | ✓ | ✓ | untested |
| TCENT | `XsXb7KCxcxTi6hqWfYyEe1kpTwtiCeU5TJbEz8N7RWn` |  |  |  | ✓ | ✓ | untested |
| TDG | `XsaY4eSxkNswy2kg8j7CWS7v154y5kkxYRiqX2ffpVZ` |  |  |  | ✓ | ✓ | untested |
| TDY | `XsBKXQehs7BBCZ8YbJ8X5B37BE1ymf9KyMJwbj6Jpoy` |  |  |  | ✓ | ✓ | untested |
| TE | `XsEn37JjZxj3m9YayAyCCJFaQKBPZc6aUEiLEus5igu` |  |  |  | ✓ | ✓ | untested |
| TEAM | `XsLhefHBtc8r9nStXgXtu9tHeEWYRXxSXrpbnfwTJ7v` |  |  |  | ✓ | ✓ | untested |
| TER | `Xsbe4fwmjVQEWEPkzfyxqNdPUUK7X9dKfTJrZdDbNgx` | ✓ | ✓ | ✓ |  |  | untested |
| TFC | `XspgPjzWCN6w4b8xHyfN8NRXrgdNMYx5nsWgiGGeK4R` |  |  |  | ✓ | ✓ | untested |
| THC | `XsBYWM8wgvSJfvNybgc6qxGxkD584FSycCWRiCvwZHk` |  |  |  | ✓ | ✓ | untested |
| TJX | `XsPWZN3FYcrvpEnxrQqogbVZtxpRX9tFomymKw2dWJS` |  |  |  | ✓ | ✓ | untested |
| TLN | `Xs8yLZVjsYmQ5Tu4e5JDVQeo4cbRRDCVERgtSGJFn3q` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| TMO | `Xs8drBWy3Sd5QY3aifG9kt9KFs2K3PGZmx7jWrsrk57` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| TMUS | `XswCi2U1G6Ppbw1QhG45yKb8UKuR1FKLJrquv2FZSD4` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| TNGYI | `XsMMFdkb82bRyNcwXxWZQqkurJuzdqZ5Wf6ydd5exBe` |  |  |  | ✓ | ✓ | untested |
| TOL | `XsnbxjqAYHWuP4Fro7GnJ3kkUh6g9B2xWUMwaVeVgyL` |  |  |  | ✓ | ✓ | untested |
| TONX | `XscE4GUcsYhcyZu5ATiGUMmhxYa1D5fwbpJw4K6K4dp` |  |  |  |  |  | no source (Solana only) |
| TOST | `XsXWXoWAzEo22ggADuXQeauMWxwgMS3em44tRBX2Vsx` |  |  |  | ✓ | ✓ | untested |
| TPL | `XsNpiekiQLb87S2VqmaYjez6sNSrjoK78nCPAF8uaCF` |  |  |  | ✓ | ✓ | untested |
| TPR | `Xs2zWfkYjSCCW4fdC1L36rz77YzTcQtji7ewjWPvuWW` |  |  |  | ✓ | ✓ | untested |
| TQQQ | `XsjQP3iMAaQ3kQScQKthQpx9ALRbjKAjQtHg6TFomoc` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| TRGP | `XsmhtZrbnheSvztwRW82ZqZqMjaRnAQqyWERFh1A4Kr` |  |  |  | ✓ | ✓ | untested |
| TRMB | `XsJ8MXED4y4NCxfX6ZE9XJiXLXLgBNzEYDtmnx2hbZ1` |  |  |  | ✓ | ✓ | untested |
| TROW | `Xs8urJdzBSFLaKqxZiMackbXDkyZbwPeAwz7PepQ1eD` |  |  |  | ✓ | ✓ | untested |
| TRU | `XsyvvjANUH1LpSQkRr3xgCyfxJLcNtpEVyFFNpJcDsb` |  |  |  | ✓ | ✓ | untested |
| TRV | `Xsxd1sqLaPsmmmYTZHr2GnNufXXiH5rZcahP99TyeDr` |  |  |  | ✓ | ✓ | untested |
| TSCO | `XsYMTZRVKs9he9redAPMhaBbCbmZvUxMTApsfCZsKzt` |  |  |  | ✓ | ✓ | untested |
| TSLA | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | ✓ | ✓ | ✓ | ✓ | ✓ | Ondo Solana live; Ondo/xStock Ethereum quoted |
| TSM | `XsafvsGtzFqqHgTnA3aPC83EAMkacU5mcGtcSayhpVV` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| TSN | `XsWV8voFNehNEbuBW8cEAMWwjicXCYskUT4616PFZ6a` |  |  |  | ✓ | ✓ | untested |
| TTMI | `Xs1PSc6DL1cdDPTbyJevgYYU7uA1wiJQESzrpWM7JRv` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| TTWO | `XssvmC28hqLgtT5kf8R8eAv3mejy4XftJ6MXB8QywTa` |  |  |  | ✓ | ✓ | untested |
| TW | `Xs1vPiv1k4jph8JkwRfnCjog6pXKuYzVVpdRVSt3hWA` |  |  |  | ✓ | ✓ | untested |
| TWLO | `XsQVYwNXBY7UNaLonk5qTbr3RzFC87CECGXWWfJomt2` |  |  |  | ✓ | ✓ | untested |
| TWST | `XsMAsw5BADYr3m19HhYeXrG1qAieeP75DT8tKn42DFA` |  |  |  | ✓ | ✓ | untested |
| TXN | `XsU4fHhJEFcrwNh4RYuHmWdaoCfsrWKEm4UEs3zTJwH` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| TXRH | `XsWFY8Ems96uFPnZJ1NwXsqeH6bczLQDDvvvab14crQ` |  |  |  | ✓ | ✓ | untested |
| TXT | `XsjWGbe4McmJXNRd6hQYsS8dEsPKTfT38fxSebugRbn` |  |  |  | ✓ | ✓ | untested |
| TYL | `XsiSQ5MUFoAwjrGB1x3FsXTthfwJnJgHVXj9tDKuvr8` |  |  |  | ✓ | ✓ | untested |
| U | `XsZygGhZ5GWq1TMrbBAibrH5Par33cKxrtZAuTQ9r9o` |  |  |  | ✓ | ✓ | untested |
| UAL | `XsKq6Ac27X857u18jH8MrWQ3bEA5ZfUSGriawpyu8xw` |  |  |  | ✓ | ✓ | untested |
| UBER | `XsAsZLF4MmsvS1sDxRMrUz7REjHfwbC9UAMXSRBqgEB` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| UDR | `XstJ29hJ96UCddwezTPe9mXLiamEApRt85ChkTSRh5f` |  |  |  | ✓ | ✓ | untested |
| UHAL | `XssRPrQZPGjgViEH2wVDAvDnFkiL9aFEE3dZ6Egbry6` |  |  |  | ✓ | ✓ | untested |
| UI | `XsLzbFA47Tm3Bs7MnSJrGbi6RnfbtCGA6pD3NHSzp6P` |  |  |  | ✓ | ✓ | untested |
| ULS | `Xspg7dCVnegasgemg56htgBWpemdffjvY9joWyNvJww` |  |  |  | ✓ | ✓ | untested |
| ULTA | `Xse5GAs99zAj5bzMAbwjooLn4AHn1Ny6nUcN6vt5vrR` |  |  |  | ✓ | ✓ | untested |
| UNH | `XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| UNM | `XsAhRsoTzG6cpxTxvH9qSze3Kwg2gmYbABi5xqrGm7G` |  |  |  | ✓ | ✓ | untested |
| UNP | `Xsehrw5hHiQ16Vfxxctj8ewUhtRCzbCrBYS278ctAAy` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| UPS | `XsnqNkeDhvaK8C5B3Z4D1ciCupVAgkw1AdS3U2uEn26` |  |  |  | ✓ | ✓ | untested |
| URA | `Xsq9sEQjYiUTSZ55RrbHAzVfz8HotwFGrqgxkgiv4LB` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| URI | `XsLR9avpksMgLqB5Mw3jBNjzdvSDUKGw4onApxDGE6x` |  |  |  | ✓ | ✓ | untested |
| USAR | `XsJJneENiaBPqqcdK1gMsfwi9cbw111azigzRYHoctX` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| USB | `Xsieiissncd7uzAW2kwNJPDKBfWcyvdibgxSMQindKF` |  |  |  | ✓ | ✓ | untested |
| USFD | `Xspjr5y1bLtPTeSg13NBzxcE3JKZjYQrdpHKxAGsQYs` |  |  |  | ✓ | ✓ | untested |
| USPX | `XsBNz5UKYqcALjS5Xnm7HesMapyKLxkmfWPGHBek36x` |  |  |  | ✓ | ✓ | untested |
| UTHR | `XsrazTRfp2iGrUcZkkoB8PpM9qApe77RbohmknHh9XJ` |  |  |  | ✓ | ✓ | untested |
| UUUU | `XsYHvpLWfTfqdLkPbCc4eUT21eH521BRTXBypgzpEDH` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| V | `XsqgsbXwWogGJsNcVZ3TyVouy2MbTkfCFhCGGGcQZ2p` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| VCX | `Xs7UsqobM3EJgMeHwdAbmDBCZH1G5WTCjatpeYcCr8x` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| VEEV | `XspuRH5i611hbZjGtYsiaLmhnGya23UU4jnwADWr9yV` |  |  |  | ✓ | ✓ | untested |
| VGK | `XsosCAu1L8Ebpr4SdBDV1EboYDRTWCH8j79UnHYzvbN` |  |  |  | ✓ | ✓ | untested |
| VICI | `XsN9HmM3TqbY317obKz1fYbRvR81MT9qbL5eUSiGto3` |  |  |  | ✓ | ✓ | untested |
| VIDA | `XsfCC9VL4DamVGNgdJpfLXB3sBVa158Gbx8sh7NzmTk` |  |  |  | ✓ |  | untested |
| VIK | `XsEWryPA68Tddfrw31uSv18aysuZ6gb4vszk856hqQ6` |  |  |  | ✓ | ✓ | untested |
| VLO | `XsmMjZH2ex52ecoCqBN1sMADoWQziXpe9j6z6QVmafF` |  |  |  | ✓ | ✓ | untested |
| VLTO | `Xs6mp36rvKSo7vTM588J1HUZF1sbNjK3KSz12fNM7P5` |  |  |  | ✓ | ✓ | untested |
| VMC | `XsAtnoftgxL6kJErDeCL8m2e364mAYgEbSfSKxi4ctJ` |  |  |  | ✓ | ✓ | untested |
| VNOM | `XsW8ts3iGPo8pxif5eFMv1Rnx6xE5Yw57Zhz2xYdhYL` |  |  |  | ✓ | ✓ | untested |
| VOO | `Xsd7TduTbjuYCFL7Uoujb8SbkZLmUsuYNLn7KdvX21x` |  |  |  | ✓ |  | untested |
| VRSK | `XsBDavbmVc22RNAgsHwUDEeC8f8VVCKLCcxFbfFUEzW` |  |  |  | ✓ | ✓ | untested |
| VRSN | `Xsy4NX4cCf4YjN6iwypnQ8crXtNkyA2K3jypAX5NfQ6` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| VRT | `XsLUiVEwYeoneKpgR1C2Q4DBUZhX4xDktSCfQqq8zmn` | ✓ | ✓ | ✓ |  |  | untested |
| VRTX | `XsgCWpLUC3pv6JmNAFtkYmuwSaikShy8QZRuripgBzn` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| VT | `XsEdDDTcVGJU6nvdRdVnj53eKTrsCkvtrVfXGmUK68V` |  |  |  | ✓ | ✓ | untested |
| VTI | `XsssYEQjzxBCFgvYFFNuhJFBeHNdLWYeUSP8F45cDr9` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| VTR | `XsEvH8WR4t5FU5GT1cfsmPnvrmEknd4UXA68uJ1F25L` |  |  |  | ✓ | ✓ | untested |
| VTRS | `Xs9uh84WXf2F4P4UVRLvNGwv753ArA69kUk6r4GKVoA` |  |  |  | ✓ | ✓ | untested |
| VUG | `XsNVBwVGqtDqmA2Waoiux5mfykH8nepLK74z3ZoQWK2` |  |  |  | ✓ | ✓ | untested |
| VXUS | `XsLT5v4DAd1kwViPQh3SZiT5kzJfNLxzJxJN1dySZTe` |  |  |  |  |  | no source (Solana only) |
| VZ | `Xs4VKGG8TTan8UN3mC1ufsDMamBtBLE4Ahfkyv2tfuy` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| W | `XsAdZrnayY88RC9cMEEaYnnKyBCALCwz6a4mmPTGUMT` |  |  |  | ✓ | ✓ | untested |
| WAB | `XsGFoZFgiRxDk49QCAQUArX84V88t7Bz3fsExp7HLuX` |  |  |  | ✓ | ✓ | untested |
| WAT | `XsGmxpiwpg9oBuRoyczLkXs7j82v9Rb4BTHwTkvXnNA` |  |  |  | ✓ | ✓ | untested |
| WBD | `XsZUSqxAXKJkEimvD4CoVvEb4WUC92TFgj5zRtBxFeL` |  |  |  |  |  | no source (Solana only) |
| WCC | `Xspj4rFiCCXJyymfNgkwBG9AXZbyp69HGyHwfz6WHTE` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| WDAY | `XsDa7zkFPXdu1wz29JLEV2XtWvrLdb16s4yH1LcKQ5r` |  |  |  | ✓ | ✓ | untested |
| WDC | `XsmopJuh6C6uNFJa3KaVoYqEtrf3Y7M5LYwRLKLER3h` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| WEC | `Xsxq7WqXpiNFrdWSd6CA27LXmCsCrGyC9C3uaebmaqU` |  |  |  | ✓ | ✓ | untested |
| WELL | `XsuKHFvcZLWvhk8XcprK4tiAZRefQ4nfTyNs6b9BArz` |  |  |  | ✓ | ✓ | untested |
| WEN | `Xs4uNhvBDAcp2mz3g9XR5q3vzLgmF1ANWxJgWk2d5u3` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| WFC | `XspHXejQ3A4VeimAqR1mAkvgTWgpmmoNR5CUhwCqzqr` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| WGS | `XsmPveq9vFqqCBfhBfDyfACu1W7bLVABkqaL3u8uFyy` |  |  |  | ✓ | ✓ | untested |
| WHGRO | `XsQDsbd6nqERiTZY2TkBheUG53QsewgCa2eaCSS4PYe` |  |  |  | ✓ | ✓ | untested |
| WHRFR | `XsXQY2nH5bKDLEHwigMzqnmicscdXei1MhduRZeF4F3` |  |  |  | ✓ | ✓ | untested |
| WM | `XscZ13Vr2dH9GV8vxVAgFsXz2YMoDCAz3QanuCcwsr5` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| WMB | `Xso4umc25VxszLT64SYNT7TMeZudAC75xwNo7qFjJFu` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| WMS | `Xs6debZjNw2y4JX8ryFWUhZgXCSjfbWdWe9r72jNjU1` |  |  |  | ✓ | ✓ | untested |
| WMT | `Xs151QeqTCiuKtinzfRATnUESM2xTU6V9Wy8Vy538ci` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| WPC | `Xs3jL3WdD8YSqLeiy7Tt7dGEeBZziFMYboyUMSr38AE` |  |  |  | ✓ | ✓ | untested |
| WRB | `XsnARtma2bEi2x1JuKuznZa1QzQkLaedxHW6KeUCz8J` |  |  |  | ✓ | ✓ | untested |
| WRFHD | `XsQqWNfMfAVg8hSfGMFzSvEfqwhid5qcZVmm6ny6g3a` |  |  |  | ✓ | ✓ | untested |
| WRLD | `XsmjCXMpgsWWchGjczHfWz2aGKdYF7WiwPPurUd6c7W` |  |  |  | ✓ | ✓ | untested |
| WSM | `XsxjGDiXTcvRjbHgAkngyJgix766hJHKB3XLzNiRSro` |  |  |  | ✓ | ✓ | untested |
| WSO | `Xsgefxs1R4c5pYqhijeA3QLT42i38J7QpBtnt4GGk1f` |  |  |  | ✓ | ✓ | untested |
| WST | `XsptQPquxvzKZ7pZTXNhvtXRxFP8vvC6BmS6QL1PALe` |  |  |  | ✓ | ✓ | untested |
| WTRG | `XsR9n59W439iWymAe3x5qnjdnaRXQmbvPE2uC9efzjE` |  |  |  | ✓ | ✓ | untested |
| WTS | `XsMcyEj7KpLQyVXQ4GpSVERstPHrHzVqDG36myTJzjQ` |  |  |  | ✓ | ✓ | untested |
| WULF | `XsuwUbQSzCJN2wZabD1Gxf1MER2Ypa7hMzVMYB2WawJ` | ✓ | ✓ | ✓ |  |  | untested |
| WUXIB | `Xsza1ZaAjp3SfM5ejn7BPdNCJePtSh7iLK58rqF4i1z` |  |  |  | ✓ | ✓ | untested |
| WWD | `Xs1xSyecLzT2u188qGFs1JTBXeE9RmBX1pc11o5X6U2` |  |  |  | ✓ | ✓ | untested |
| WXXDC | `XsakKPtdcDAk78qkX3vqdJucecauLw6tcL6BJhG5nA8` |  |  |  | ✓ | ✓ | untested |
| WY | `XsrTDXGz8cxi4s4vQrX63NhrtZZmPEFkgbsJQG7UERR` |  |  |  | ✓ | ✓ | untested |
| WYFI | `XsLkMYrJVUPJv23tH3PB167BV6kpdubPe5F3KfVvSFN` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| XEL | `Xsr6MgLKmoEmN4aL78MQ2q98R8wJnZ3FaCZUMwkNbNU` |  |  |  | ✓ | ✓ | untested |
| XIAO | `XsvP4b65AoC8f2hEuXj3yAKzRCLtW4aCQupZcuK1vAe` |  |  |  | ✓ | ✓ | untested |
| XLE | `Xs54CrhmpVp6uxZXwgSTegrRH2kShh88XFPzgf4BExu` |  |  |  | ✓ | ✓ | untested |
| XOM | `XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| XOP | `XsAk6BoV4kBXUM6WXodKyM21CN92G9jArwAzFvbh3LX` |  |  |  | ✓ | ✓ | untested |
| XPO | `XsJF1CN5uFwF5eD7b8htZDeYzY9o4kdepkvBdsa32ZT` |  |  |  | ✓ | ✓ | untested |
| XRX | `XsensupeZBdHxZtdnLptf1UfWpVyancWcit7qWFYZrJ` |  |  |  | ✓ | ✓ | untested |
| XYL | `XsqFzD9CqfpnmTiFH631bcvQcDReVTMFZMSjk5aXQZL` |  |  |  | ✓ | ✓ | untested |
| XYZ | `XsDP3d7dBNMVVZT6W5abD9jxZPGbrenPaj322sWn9Ct` | ✓ | ✓ | ✓ | ✓ | ✓ | untested |
| YLDE | `Xs4uZnG2mzZQKgnmuYboj1PRBtascAvWh5NdVMfz2aW` |  |  |  | ✓ |  | untested |
| YUM | `XsNor8pbicnexAYvgvq3p8EXwyRj9UzjYu92ZnrJLqC` |  |  |  | ✓ | ✓ | untested |
| ZBH | `XsE48wmot6dKRcCGVQUXFSrpnRZ4U4yC762ZktjkoGW` |  |  |  | ✓ | ✓ | untested |
| ZBRA | `Xsxe5ypvCfynj9q9bJgB2Y88sZNCnxtEb9icgdbsPFT` |  |  |  | ✓ | ✓ | untested |
| ZHAOM | `XsPRsZhqX1Ef1n7bwLtyA6hZPP96Gp99H11MHHA9UQ5` |  |  |  | ✓ | ✓ | untested |
| ZJGLD | `Xs64245JybP9rgXJZJZcxKKRwqJnRpGKzoKtVNcyhoS` |  |  |  | ✓ | ✓ | untested |
| ZM | `XsgDPEr2Zk1YkWnw1Mm77APoZpeTj8BQZeGSMVtBZGd` |  |  |  | ✓ | ✓ | untested |
| ZS | `Xsb1a2VbaT6rLLq48qcgMQ1iPbs5fW2JZZURBxKfhY6` |  |  |  | ✓ | ✓ | untested |
| ZTS | `XsRPgsEQ3dFR84DhMv18jtob5D77FivAsTTsv1jCYmv` |  |  |  | ✓ | ✓ | untested |

## 2. Ondo-only tickers → Ondo on Solana

No xStock exists for these. Route is Ondo Ethereum or BNB → the Ondo Solana mint. All untested.

| Ticker | Ondo token | → Solana mint | Ethereum | BNB |
|---|---|---|---|---|
| AAL | AALon | `9wYZetvT8J2ptfsRca5gzLBGvcUug38mp9yT3xaondo` | ✓ | ✓ |
| AAON | AAONon | `nwPWRVFCbU3cdXWdJsuwomC5u459xPFdP2vYsmVondo` | ✓ | ✓ |
| ACHR | ACHRon | `KcCVQxG9LhFYP5o9DWFKTFgFShPPQkDEemVbiFyondo` | ✓ | ✓ |
| ACLS | ACLSon | `jDoTgDRKSgVzkKdkaHZL3DiVmDM4YtYWwRG6Tgfondo` | ✓ | ✓ |
| ACMR | ACMRon | `nkbH2doD7nU4CkKVwzmd6UV4d2AaGy24NHzsh6tondo` | ✓ | ✓ |
| AEHR | AEHRon | `ZWUSgDGQTQPGJyipzgJKcPhxgZzSBi4q6dqQbgCondo` | ✓ | ✓ |
| AG | AGon | `hrZ5vs6c6v1iWyvEXjGSHs3sQuuj58VzXikNyRWondo` | ✓ | ✓ |
| AGG | AGGon | `13qTjKx53y6LKGGStiKeieGbnVx3fx1bbwopKFb3ondo` | ✓ | ✓ |
| AIP | AIPon | `jmnrdSzu293vKTWyEx3A2ZRVxxytJKW1wD3CLzkondo` | ✓ | ✓ |
| AIQ | AIQon | `uwh6Z6c2F8WZfUSK1A8VBfA9AwJKN5T2bvQwVFLondo` | ✓ | ✓ |
| ALOY | ALOYon | `ndHvUEgrvZquSR6wZv2cG1AiBr7e7HGuWvfPULcondo` | ✓ | ✓ |
| AMC | AMCon | `C9xNaNujcF1a5fidWAAFReFYqhLRVbyk4yPyGqzondo` | ✓ | ✓ |
| AOSL | AOSLon | `b98FynyBEkdhP4Y3QUvKG36nms4oMsxEZUrCBMvondo` | ✓ | ✓ |
| ARGT | ARGTon | `rki25TZmDh94spjeoyyGWjkVEYSzcVvaAbddXGuondo` | ✓ | ✓ |
| ARQQ | ARQQon | `crakmaGKTuVRYqSBsFsuqio5CmpEQnpibDrVLbDondo` | ✓ | ✓ |
| ATKR | ATKRon | `ZsCDHjWFyndwgbHMs4AHYwJZQMgmAn72ESQj2b5ondo` | ✓ | ✓ |
| AXP | AXPon | `1WxT6NdK7uqpfXuKpALxL2n3f7Rq61XXeHA8UM4ondo` | ✓ | ✓ |
| BABA | BABAon | `1zvb9ELBFShBCWKEk5jRTJAaPAwtVt7quEXx1X4ondo` | ✓ | ✓ |
| BAI | BAIon | `gKkrSgVjRjdQX4LFErBka1izQhoW2VHXFcCS5Vbondo` | ✓ | ✓ |
| BBAI | BBAIon | `YXE7mph6XhsgnyezkMEcTuohSuWhbLWfwx2Hh6mondo` | ✓ | ✓ |
| BIDU | BIDUon | `54CoRF2FYMZNJg9tS36xq5BUcLZ7rju1r59jGc2ondo` | ✓ | ✓ |
| BIL | BILon | `wtwpt5yJbButAhjpYhtg4uvUgCQN4LVgvLq2AxEondo` | ✓ | ✓ |
| BILI | BILIon | `14kLsQVmc64qZexYuR4XGop9y8BeMkd77pJUm1Rhondo` | ✓ | ✓ |
| BINC | BINCon | `mhZ69E1vDnAsQJXAwarLYSX5tmgeMajXBJ2rXAcondo` | ✓ | ✓ |
| BIRD | BIRDon | `vzTpf9YNDwYaQpTCKjQzXcPBUfheW74TuZMEyPhondo` |  |  |
| BKCH | BKCHon | `uyWDgDZqL6x2V86i7vwJTKPuyg2u79UYaBe5yt7ondo` | ✓ | ✓ |
| BLCR | BLCRon | `g3jQMP79SxnH1KisVw3C4SBpa8gSbPAocNJruJFondo` | ✓ | ✓ |
| BLK | BLKon | `5H1VpMzRuoNtRbPTRCz35ETtEUtnkt8hJuQb9v7ondo` | ✓ | ✓ |
| BLSH | BLSHon | `A9PFmw9Hu8zzxDUoU351pio1E1XWBWBfWnjT9qoondo` | ✓ | ✓ |
| BNO | BNOon | `BAU83kqEqhyiexfAMQhZZE5KnGogSqh17fJc44Sondo` | ✓ | ✓ |
| BOTZ | BOTZon | `soLM6jRVdG1PdurSAQDz5qRtwWxXPM6EBvwrkBjondo` | ✓ | ✓ |
| BRHY | BRHYon | `fznj92AnTcQ6mAFvt68JgLJS5pHag5uPmJ7LmSLondo` | ✓ | ✓ |
| BRLN | BRLNon | `fcfpT8y5fpEBJjqmjKLpscZYzVjxR95ErJsb31jondo` | ✓ | ✓ |
| BRTR | BRTRon | `gPwmyo4BM4qgYYCTVgA4eJmzsnYNVMUJYBecYkCondo` | ✓ | ✓ |
| BTDR | BTDRon | `kBUAHgGHFthfnwarWxqYxHqVDnqqieJkXb6kvroondo` | ✓ | ✓ |
| BTG | BTGon | `cBnVXDyZgaaLZM18wAmqsUKnRUFAEJWbq6VuUoaondo` | ✓ | ✓ |
| BWET | BWETon | `m7mWfvhyPikY3esNwTk8U1JRbcBijmzHgqiqx3xondo` | ✓ | ✓ |
| BZ | BZon | `doPqjCxi6UkANkvMz5fSuYGEo5PGppVpTZMeB5vondo` | ✓ | ✓ |
| CAMT | CAMTon | `ZcS6FuJ1nAjgwJejUsxkasM6JpEDkdowVyohBCzondo` | ✓ | ✓ |
| CAPR | CAPRon | `BS8zoc6pmALQnBhBDFak6eFhgGHjpebnHzsxApgondo` | ✓ | ✓ |
| CCJ | CCJon | `fVPj4hHHVEeUrzVnad5fvxFEPGAXD5X6wkw1Xjdondo` | ✓ | ✓ |
| CEVA | CEVAon | `nLTgFdT7x37oXMbZoZxbQ1787qSPVRLXo7JPRkLondo` | ✓ | ✓ |
| CIBR | CIBRon | `BVdL3WUxtxUD4vXRWwqChJLbGxvfzZjBGPp63Wtondo` | ✓ | ✓ |
| CIFR | CIFRon | `WNZBSkNBNP3Ct1pcFn6Fu4sZQFhnu48EsM9voCEondo` | ✓ | ✓ |
| CLF | CLFon | `fTuoE9pWbVK7EUpUEENBn8Vu226T7kF3YJBTRLPondo` | ✓ | ✓ |
| CLOA | CLOAon | `t71FyTYHVkPAb5g48adDHmkVxXYbUuP2eq6jDZLondo` | ✓ | ✓ |
| CLOI | CLOIon | `ucQ3VfWAx9pkCN4Kg84zE56FtB4FJN2kQH4ArYYondo` | ✓ | ✓ |
| CLS | CLSon | `eL1buL9zFxFhfRbjMfyPu2q9HSAJkUUnHVUgkPdondo` | ✓ | ✓ |
| COHU | COHUon | `jYMxpcgARQCdvQ15H1vvRCnBUbUEEQgSnS6SsfTondo` | ✓ | ✓ |
| CORO | COROon | `gNhrgh21pQozQoc7YtvhdKF7eJnSKwWa9dzHnaxondo` | ✓ | ✓ |
| COST | COSTon | `6btaz134wjHkR8sqhAYrtSM6tavftfxnRvnyMd8ondo` | ✓ | ✓ |
| CPER | CPERon | `hpkpc1Xenv5oEpVefk3woWjZa9rxaJxaEaVVA4Fondo` | ✓ | ✓ |
| CRDO | CRDOon | `d4Rc6KvP3nQT8zC86Z31zM1DJCSfUD6y424cKnZondo` | ✓ | ✓ |
| DBC | DBCon | `td1aY5AvYQuwGD75qNq9aPipMexraN9mQXJwqifondo` | ✓ | ✓ |
| DGRW | DGRWon | `gnoSQSNTNZHViqVfxCcPDVxcRA29mrJL7C6JqYLondo` | ✓ | ✓ |
| DGXX | DGXXon | `jwCKwGoJfx1p4K5XCwqPrq1xyJU1g26Tmf6UcDcondo` | ✓ | ✓ |
| DNN | DNNon | `12J2LD3tuLfdiVKnWZMHRMrbnXDY9rM4yqVLUa5yondo` | ✓ | ✓ |
| DTCR | DTCRon | `t29YBAB7g6xzgRJkzmc5NkQ7YRjE3NF8mhsLgppondo` | ✓ | ✓ |
| DYNF | DYNFon | `g7vMfs5FrR8JjieeGC3c9sJaYPp4G3jGPfF4tkyondo` | ✓ | ✓ |
| ECH | ECHon | `BmXVAFyfpW7VuVYeWDtbFtLx7sek2mZt3BEsGgAondo` | ✓ | ✓ |
| ECO | ECOon | `mnYetf4bWKX8HihNk1XLNYj8BPPy9PdkDFPV97Zondo` | ✓ | ✓ |
| EEM | EEMon | `916SDKz7y5ZcEZC9CtnQ5Djs1Y8Yv3UAPb6bak8ondo` | ✓ | ✓ |
| EFA | EFAon | `AbvryMGnaba9oADMZk8Vp2Av6MtczsncGyfWaC4ondo` | ✓ | ✓ |
| EFV | EFVon | `uzQx2MnWr7drR5gdNXssJrFKQkLFSdw4EpfaQ5Nondo` | ✓ | ✓ |
| ENB | ENBon | `aqEnHXRnXEQwDXEiFSEU4xHziw3Fco4b5JPkTtnondo` | ✓ | ✓ |
| ENLV | ENLVon | `BncvtBGs4JqgYZwUoq3EN9q9HUFqJKTfWpvCsHCondo` | ✓ | ✓ |
| ENPH | ENPHon | `Bp26APthMuM46gMFTo5KYpo7b92GN2xSCor7f9oondo` | ✓ | ✓ |
| EUHY | EUHYon | `teUYhoQUgqsFp9ZwYBUHfuUHdVvbNx9N8spESGqondo` | ✓ | ✓ |
| EWJ | EWJon | `C6c7VcxuUYcV5YTsky5HM4PUmfwHTwsDD5DNwwPondo` | ✓ | ✓ |
| EWZ | EWZon | `CBKcmEvVg5EgE3W5hVSPcBYWh6TFVjQwbmYod9Pondo` | ✓ | ✓ |
| EXOD | EXODon | `CJRoTbu98waCCuLFfLuJ2kXawLk889fqW4UAAbwondo` | ✓ | ✓ |
| EXTR | EXTRon | `js1cCZRNx8ircYiQJuhBNMnsA9owr6ZLYx6z2uNondo` | ✓ | ✓ |
| FCEL | FCELon | `dYDS22uTX8CtiyixnXY9fMVGAkxbemVAjbCaWVbondo` | ✓ | ✓ |
| FFOG | FFOGon | `CYAwMGyuNSDu7NpuccNwcxMNS5Bu9akxU2Jooyiondo` | ✓ | ✓ |
| FIG | FIGon | `aLDdFsr3VTUQaHFK6yNvQxztvxQ8nxW4AMuSGC7ondo` | ✓ | ✓ |
| FIGR | FIGRon | `ZmHxc6Gt27RJKxD2ay6UL4n9yQ7mKAq4XZQUeVhondo` | ✓ | ✓ |
| FLEX | FLEXon | `iicfp8Efr4WfGAP9gXmYzdxmNFi1LV3iVudAmCnondo` | ✓ | ✓ |
| FLHY | FLHYon | `CZ3FxxSto7tsjkSkqMek1C5p3RCFFmkwKqW57nbondo` | ✓ | ✓ |
| FLQL | FLQLon | `CZ9GBn1okotqKNUUqoxk4PF2JVi59bw5GWvVo6Dondo` | ✓ | ✓ |
| FORM | FORMon | `ZDnkXeN5awDioQjP691XFLdgZwDAv19g3fCr9KWondo` | ✓ | ✓ |
| FPS | FPSon | `m3XghfWMqmVE81LKLVxd1FVCKjqYAUxH8bMHGhzondo` | ✓ | ✓ |
| FTGC | FTGCon | `ivBnfPTyuHDNWmMSnbavckhJK6SHZW8h77nZKsEondo` | ✓ | ✓ |
| FUTU | FUTUon | `Ao5rKFRQ54W3DKSAtqfhBRPNHewwWRLNLao2JL9ondo` | ✓ | ✓ |
| FXI | FXIon | `CeFbGYXDmkyfo1TXXzzZ512mtnCCewNohu6V15vondo` | ✓ | ✓ |
| GEMI | GEMIon | `NrTdGMA3ujUvWXkwXyZKnhoByb32KTjRh5Vo47yondo` | ✓ | ✓ |
| GGOV | GGOVon | `tzuC3sZnHg7spuAFhdCqivx9qtJg15qUBUpCJx1ondo` | ✓ | ✓ |
| GLTR | GLTRon | `CgnZbDNzBfaLyJqUtd4esKLShRp7RznQuwP4uQaondo` | ✓ | ✓ |
| GOOG | GOOGon | `jcA9zXHWuTuDFDDDDYJTNhersed1B5etkuB6X9Eondo` | ✓ | ✓ |
| GRAB | GRABon | `m9GcsVgdjaL3KsdtSFHimnhtsUMpTHkjtwEG4Tzondo` | ✓ | ✓ |
| GRND | GRNDon | `Gc1aT3ay7FXL3qdAW7cNSXYPDsGavy7qiACuxwxondo` | ✓ | ✓ |
| HIMX | HIMXon | `aCx5G8ewGTSzozEn8KmSsr9cvfyFWzGnr22GjFXondo` | ✓ | ✓ |
| HIVE | HIVEon | `kTMQKHhnWPTvZsfiZfcdeHdG6dMgZV27wXSiC3Yondo` | ✓ | ✓ |
| HLIT | HLITon | `o3pnLke4uti6hY3LTfb2wVBpHeWG7znjJHj6VXtondo` | ✓ | ✓ |
| HSAI | HSAIon | `nagL8iWMNLZVuKFk3bUGDaHyT5ZY4bNfUzsdtGHondo` | ✓ | ✓ |
| HTZ | HTZon | `QApMAZTHvfhX2dTDzM8AMyAHVyhmPVwj4oY8Jveondo` | ✓ | ✓ |
| HYBD | HYBDon | `71VH3YQkjqqGxzwYvGhsCsJNQYzkMo9Rg72aVxqondo` |  |  |
| HYG | HYGon | `c5ug15fwZRfQhhVa6LHscFY33ebVDHcVCezYpj7ondo` | ✓ | ✓ |
| HYS | HYSon | `CsN1Tyz467bSFLPGd6MJyZhPNtwDaWZtX8ixHWyondo` | ✓ | ✓ |
| IALT | IALTon | `gfKuBLive7Q35MYgxPgNx7qx524zQJ9RiDZJFZoondo` | ✓ | ✓ |
| IAU | IAUon | `M77ZvkZ8zW5udRbuJCbuwSwavRa7bGAZYMTwru8ondo` | ✓ | ✓ |
| ICHR | ICHRon | `ZTABSukbFUFcuCYpMFHxN18aB4kPL2NkpZpgnXPondo` | ✓ | ✓ |
| IDEF | IDEFon | `th3tot4SRq6jgEyJ568NEh42MM82RSJ3NkiWeNzondo` | ✓ | ✓ |
| IEF | IEFon | `D4uWxzR5StYC6sTRhVts8Eboy3pmVtHeNC62dnQondo` | ✓ | ✓ |
| IEFA | IEFAon | `C9J9vZ8N79GzzxFoRkPWCkGtMKU8akg4FhUk4r9ondo` | ✓ | ✓ |
| IEI | IEIon | `wuzf2FDZTRbRY3ZnndMeQ38Wk9YTDGGXTA63nUyondo` | ✓ | ✓ |
| IGEB | IGEBon | `feZXF2iFspS6QKE4LSXeSESRXgrtvzbE3dZSyydondo` | ✓ | ✓ |
| IGV | IGVon | `jYxKRFuXr6PEkzPpf1wWF7DhLL4gxGJ95Pv2NGrondo` | ✓ | ✓ |
| IJH | IJHon | `cfPLN9WXD2BTkbZhRZMVXPmVSiRo44hJWRtnaC8ondo` | ✓ | ✓ |
| IJS | IJSon | `v34vtrbcjDswpFDixpVFThmUWeM1RTZwtWcp5FBondo` | ✓ | ✓ |
| INCE | INCEon | `D8KT4Jd8qiKKTfkM8ejSKCpWGR1o3GFvnQGp5ERondo` | ✓ | ✓ |
| INDA | INDAon | `DBNwt3FoYCKQWdfzxKFNZ4mzuz4Jz1iRzFf7HFzondo` | ✓ | ✓ |
| INOD | INODon | `nTUjRdtzGCy8FXHK8w1n11pHABX6Dc7L7WSpzdBondo` | ✓ | ✓ |
| INRO | INROon | `g4kT9HEg7rN4e5ZaEGHmzpkdM8qMbsZSHJojKeCondo` | ✓ | ✓ |
| INSW | INSWon | `mV5mof9x8nDirrHwT7g16MarvHbnRvz2zN2S4Cspyon` | ✓ | ✓ |
| IRDM | IRDMon | `go6DXMdM5zHTC9G16BwAYA8rKwGRhy9M5uudNdBondo` | ✓ | ✓ |
| ITOT | ITOTon | `CPWkMURVvcnX8hGjqCTb8i5LkzV3VSvyk7SeJi8ondo` | ✓ | ✓ |
| IVV | IVVon | `CqW2pd6dCPG9xKZfAsTovzDsMmAGKJSDBNcwM96ondo` | ✓ | ✓ |
| IWF | IWFon | `dSHPFuMMjZqt7xDYGWrexXTSkdEZAiZngqymQF2ondo` | ✓ | ✓ |
| IWN | IWNon | `DX7g7WNjDpVzNK9CG81v7wb6ZbiNzYfkdzH2Xs5ondo` | ✓ | ✓ |
| IYW | IYWon | `vr8RQPDmYQBruiYsFSV3KZyoWFEsEejxzMCdWrBondo` | ✓ | ✓ |
| JD | JDon | `E1aUS5nyv7kaBzdQzPVJW5zfaMgoUJpKYzdnFS2ondo` | ✓ | ✓ |
| KEEL | KEELon | `kSbeWEe64qpoVb1ZSVxgRnekZ1PwGNJkLyL5gJWondo` | ✓ | ✓ |
| KOPN | KOPNon | `eSu547weHVErV8nax42PyJzPT8JodhBfXLDp5vyondo` | ✓ | ✓ |
| KWEB | KWEBon | `DVPSYdqWPLvNa8afnEqa3B9eDfTTWpGyUZeXvdMondo` | ✓ | ✓ |
| LASR | LASRon | `Z8aFb6uQJgwFJ4KYKrT8n53aP66xqihodfAu4AKondo` | ✓ | ✓ |
| LEMB | LEMBon | `teZfcA6zpP476eKzED1daqBWDtuwbk9e2Ejk2cpondo` | ✓ | ✓ |
| LI | LIon | `v12TwfofSbvVqQ5N5KGG4d3J8rtEi4BjGfn2apyondo` | ✓ | ✓ |
| LIT | LITon | `syb82jXkHWbcWgxoRqrvAcoCdsAb3y1fnCYo561ondo` | ✓ | ✓ |
| LPTH | LPTHon | `dhEXYTmQKbYBH3wbWTMqeZZpADSRprM4jiGYbUMondo` | ✓ | ✓ |
| LUNR | LUNRon | `DiDWPZ7vQXfpaeQ8BX68XuDYeiQLv7diDxdeUpaondo` | ✓ | ✓ |
| LWLG | LWLGon | `dKGNHXGsZL4GZ4UBTCjpPbaMerqe1EdZ7aFdCxHondo` | ✓ | ✓ |
| MBLY | MBLYon | `eCSPcjdpdKL1546PU3RM6BXkebuKn8iH4iuMcTBondo` | ✓ | ✓ |
| MEI | MEIon | `jiwgLgWJ8f6aEsM6hcSCrXLNnGpYfjmCVbqqAcwondo` | ✓ | ✓ |
| MELI | MELIon | `EWwdgGshGngcMpDV34pWZRSu5bkAuiKuKTTHKQ8ondo` | ✓ | ✓ |
| MXL | MXLon | `aGn43ed4kjATwbVqsAuwAT24XcG9xABCcyQsFpqondo` | ✓ | ✓ |
| MYRG | MYRGon | `auLvQAhUzPuy2SQBSq2T6AofPGNkR4nZ83P8pjuondo` | ✓ | ✓ |
| NAT | NATon | `mmy8WbFRNrjoDsPGqpYmzQAVu7PfGhMCdSRLxZLondo` | ✓ | ✓ |
| NEAR | NEARon | `bD6TafGhPo8NaeKEyge1DrZGAPB5wxK3x4fCpqjondo` | ✓ | ✓ |
| NIKL | NIKLon | `V8LRV7kWjrx6Prke9oHEHNUiR122BVtyuPciTCTondo` | ✓ | ✓ |
| NIO | NIOon | `yQ37dFiGAbzrb2FRAEhGNzRy5zFfoYGWYhAepFEondo` | ✓ | ✓ |
| NNE | NNEon | `bz2iUTXWkutnfwG32ziABcTzXoM91sdcgdiJJJdondo` | ✓ | ✓ |
| NOK | NOKon | `amE2ANm5dyG6RTkJHdtzvWcuR8ChBZCEm5Jiqwdondo` | ✓ | ✓ |
| NTES | NTESon | `YeK2TdPtGLAme3Phg4pb1GBN2YxKgX5UNVyD4asondo` | ✓ | ✓ |
| NVMI | NVMIon | `nupQ2BuCfoVeCHVLRDhTjLJanaf5cxZ81KVFqs6ondo` | ✓ | ✓ |
| NVT | NVTon | `Z7G1bRFYH47se4g1ppqSgtMzeJs4JjzzFPmt7iAondo` | ✓ | ✓ |
| NVTS | NVTSon | `fXXYmrdSAwVmtNo1ZwrkxVep7BxTsusGzmUZJSPondo` | ✓ | ✓ |
| OIH | OIHon | `DnvbCqRuUYssmKVRBRNwkUnptHitH4ZZTt1KVuZondo` | ✓ | ✓ |
| OII | OIIon | `gfTDvjLp8K5gNDFaLMvoTZWJJY6PmVQfdPaUU7eondo` | ✓ | ✓ |
| OPRA | OPRAon | `gbHFTMkuMQUy5xrgoCBdaQ2XYvNyjWAYcnRPh9Condo` | ✓ | ✓ |
| ORBX | ORBXon | `t5XWftMCacS1p3xrg14ARaxgEvEM5R241kxHGqrondo` | ✓ | ✓ |
| OSCR | OSCRon | `ThwGDsXZ6iKubWuEQjmDxGwF3bUERDGbBXvcbjFondo` | ✓ | ✓ |
| OUST | OUSTon | `aV3R9NPU6TkyA6r9NPF5bmAw5XXsjUU7r2whgBqondo` | ✓ | ✓ |
| PAVE | PAVEon | `DsLQ18ooPjiHYuiuQ5Jz8PNCpVaKe3FhAYpvMxWondo` | ✓ | ✓ |
| PBR | PBRon | `GRciFCqJ5y2hbiD6U5mGkohY65BZTXGuGUrCqf7ondo` | ✓ | ✓ |
| PDBC | PDBCon | `M6agiXbNgy8Xon9ngiW4ZDPbMFcNCTMkMMkshZyondo` | ✓ | ✓ |
| PDD | PDDon | `PnjETBCLC318DRejo9cMQKAmET9PvW8AEFGWMNtondo` | ✓ | ✓ |
| PENG | PENGon | `dWFwjcUKdc7bPH9GEebpJVmEmUjvQTgEWGVR9WYondo` | ✓ | ✓ |
| PLUG | PLUGon | `TnfswqdE1jAJ8sfnf5J7kSVLEH1cfpAYZ8MWmKfondo` | ✓ | ✓ |
| POWI | POWIon | `ZifkbVBh94FSETjAfoLw587nxmGsYtXayAAUQgzondo` | ✓ | ✓ |
| POWL | POWLon | `fRFzaZfGSXPf2r4oBgBBXpisRovMaJZjv1aCQBsondo` | ✓ | ✓ |
| PRIM | PRIMon | `kcc5QzXDCQ61qQ5Nbpi2RppnRSzhG1XQNXkjXwoondo` | ✓ | ✓ |
| PSQ | PSQon | `qKtU9A7ij34XmtxaSzYfxCpkgAZzzFsqnUb2kW2ondo` | ✓ | ✓ |
| PURR | PURRon | `rsiKbHCdsvmExvDfkYWypAXFsqKz6V8XuoxbkHtondo` | ✓ | ✓ |
| QBTS | QBTSon | `hqJXutLF6f7DxStrWCrnZDfXzbNTZmvi3KheVi6ondo` | ✓ | ✓ |
| QLTA | QLTAon | `fkznXN9GALK7f9zVr2RwRHWCPhwoima4zB3JbbNondo` | ✓ | ✓ |
| QTUM | QTUMon | `iJAAwDNzJHbgKm5pksL3kXHc3zZewYm37dsZNCPondo` | ✓ | ✓ |
| QYLD | QYLDon | `ueEYw3Djy9GVu9mrP6jum8qNpxshgcy7gMfmntWondo` | ✓ | ✓ |
| RDW | RDWon | `E6KSaqjvqe2HiUpbEweRxLK4RimQddigm95H9Jaondo` | ✓ | ✓ |
| REMX | REMXon | `tiitb2Z1HtpB2DpVr6V7tdCFS3jmTinLeuGj9EVondo` | ✓ | ✓ |
| RGTI | RGTIon | `dwEPNKQab3iwRmjGvZPXhAmws1W5NsQGwuXwi8oondo` | ✓ | ✓ |
| RMBS | RMBSon | `jjnSEAsi8UbCez7x9XCbWntLWRHBdc2tWSdC3uoondo` | ✓ | ✓ |
| RXRX | RXRXon | `q16ZLSbANUhpcq15pRUXRxNFfEqgpde9mSBwRcyondo` | ✓ | ✓ |
| SAP | SAPon | `bjbrNi96mXAzgvxSuGJ2SRJ5U4N8agbG7wUAKAjondo` | ✓ | ✓ |
| SEDG | SEDGon | `EAwP9LGNjTkQ2YeKE6CGKqBYtrJ6APFvRe7KCMmondo` | ✓ | ✓ |
| SHLD | SHLDon | `siVse6kjZb9ihaXHaqoG3mhHyTPEnNCkvSDTheoondo` | ✓ | ✓ |
| SHOP | SHOPon | `ivdDracs2s7jCP698dJXKSEQdVrNj9hasJL1Uq1ondo` | ✓ | ✓ |
| SHY | SHYon | `EEy57xbaLcUrN1HXj2vz8VWxeWFK1eZQZo4aWbrondo` | ✓ | ✓ |
| SIL | SILon | `uiSLmtLdqxtbQq5gkwYBvBrZpnSNXZn8h6sjLsDondo` | ✓ | ✓ |
| SLB | SLBon | `i7ZS13SF6BCKbzvLujp2UqLNMgM1XVnZ7A7wC6tondo` | ✓ | ✓ |
| SNAP | SNAPon | `a2cXfonVgQ6cKB4Lm8YZsPry39VZSA562bwmRSiondo` | ✓ | ✓ |
| SOUN | SOUNon | `vE2qArmjto6VfeMngyGAnzp2ipLYeXsxiARDnnXondo` | ✓ | ✓ |
| SOXQ | SOXQon | `io3eLhnjT1a94JpzAUMWKqwMYHZRwvtGXjkkXsPondo` | ✓ | ✓ |
| SPGI | SPGIon | `JrTYw7A9jihX5TwpRStYviEbsYf2X2VJpZ13719ondo` | ✓ | ✓ |
| SPOT | SPOTon | `jzCvs2Pk8tDcfsFRqnEMjurgaQW4iQfEkandUR8ondo` | ✓ | ✓ |
| SQQQ | SQQQon | `D1tu7Fnm3cCpKyyPXrqm5GXShPqMj7a2SEjjq9fondo` | ✓ | ✓ |
| STM | STMon | `bM2VSRfbYPt29YRD9F2wTCSCSQaHtNCuz1znNDCondo` | ✓ | ✓ |
| STNG | STNGon | `mFyszXnJf8BFR8H4o33pCZS1T36BH9LjtG3gTpdondo` | ✓ | ✓ |
| STX | STXon | `EXtprP1wzrNo2bByrU9JyzqEg2hQMSCVJakeHHYondo` | ✓ | ✓ |
| SWKS | SWKSon | `iJtKb1CWnWdgJhs7HgSZvLmSJABGGMc97QeuG7tondo` | ✓ | ✓ |
| SYM | SYMon | `nP42LxpSZkUfnBUxiFsHxL5GKYWRZ1VxqGkMTNwondo` | ✓ | ✓ |
| T | Ton | `WKMZummev5UcXz5nNKQZvTD6QjNSM2X58uwmDReondo` | ✓ | ✓ |
| TASK | TASKon | `nQysX1ZsRJ8yTJg8smZTZ91rWcVBabDRqdUEKZHondo` | ✓ | ✓ |
| TCOM | TCOMon | `9PMjLqd8zPdKkJUXarnit5t7tPL3cCscwHzy7ATondo` | ✓ | ✓ |
| TEL | TELon | `ZjYCwYeG85TbV5oXkCkvWQTNPh2PgTQ8X4nxpbyondo` | ✓ | ✓ |
| TEN | TENon | `micfqeFfvD9iDKKzuqRHXerFxG8K5VfY8CgrcQoondo` | ✓ | ✓ |
| TIP | TIPon | `k6BPp2Xmf2TYgrZiUyWfUoZBKeqaDbvPoAVgSx2ondo` | ✓ | ✓ |
| TLT | TLTon | `KaSLSWByKy6b9FrCYXPEJoHmLpuFZtTCJk1F1Z9ondo` | ✓ | ✓ |
| TM | TMon | `kbmF7ERJWMaaDswMprrH9gHSLya5D2RMBNgKqg3ondo` | ✓ | ✓ |
| TNK | TNKon | `mPAqB3y5N7fWmEh1BoVtrLhZKBkQe7LjBCrYUNbondo` | ✓ | ✓ |
| TSEM | TSEMon | `cRx9VtwwPTZbVk1DjbMyKzrMWn7nJA22UpMyzFYondo` | ✓ | ✓ |
| TT | TTon | `erp2t2My8UoFgyRt39EmnnSiDUwUM5aNKw5piBKondo` | ✓ | ✓ |
| UAMY | UAMYon | `nbwNoPaFYNY2c3u4iK6U59ySC2ehFrpjdpfbyLDondo` | ✓ | ✓ |
| UCTT | UCTTon | `jCPs1JpVKAwevND3jzeDGAUBBFkJ5TUtiu2SxLbondo` | ✓ | ✓ |
| UEC | UECon | `EYo8D3cLdF1CDeGms5M5VHyU52HJYinkMZ1cqvYondo` | ✓ | ✓ |
| UMC | UMCon | `ieocA48cBX3oiVECgosMGxG649wnf7R8EkVrA5fondo` | ✓ | ✓ |
| UNG | UNGon | `Es2ipHL7qXBcLmZ4N7LP9PHBHaWaTMTAkxDwGGjondo` | ✓ | ✓ |
| URNM | URNMon | `hieZTEZNBU67bMGULK9hWCB9h5jBPKdpRWiXpwkondo` | ✓ | ✓ |
| USFR | USFRon | `o6U1Sm6Vd7EofMyCrL28mrp2QLzgYGgjveHiEQ5ondo` | ✓ | ✓ |
| USHY | USHYon | `aau4XCAZR6p9uC4vgdHdh4ip3oW5pr5PrNs3FJ8ondo` | ✓ | ✓ |
| USO | USOon | `rpydAzWdCy85HEmoQkH5PVxYtDYQWjmLxgHHadxondo` | ✓ | ✓ |
| VDE | VDEon | `hKVpWfYwP1VJ9BcBTPRcovcSpEkvnaN8eXwFoCMondo` | ✓ | ✓ |
| VFS | VFSon | `F3V1fKLKv7H8aNdt9TC6GQ3X4LayEfGHsPi8Umaondo` | ✓ | ✓ |
| VICR | VICRon | `f9nfUo4SdhCGfHmm81m3ArgDsatwo2jLjEcgCcYondo` | ✓ | ✓ |
| VNQ | VNQon | `F3dMJ9H137YUNc9cpN3gBWDSq4MSRbTFtojH65Uondo` | ✓ | ✓ |
| VPG | VPGon | `dYF78b65HS62V3pku2uYFyektYzAhx9YACv4hWfondo` | ✓ | ✓ |
| VSH | VSHon | `jbzBdFNddeEiJXGcVH4DE2qUyYfTtyY2vaHJDEZondo` | ✓ | ✓ |
| VST | VSTon | `h6MW8GFpfzxFa1JNn6hZNnBF3t4fj9SHAXKy6LXondo` | ✓ | ✓ |
| VTV | VTVon | `KuiYLPVq65qixD9TgvxBC576C4gG6vVTCdbh2zFondo` | ✓ | ✓ |
| WLK | WLKon | `mrNSd1y72F7Dx2Uip4vidtsJKKd8iJatTKGX6Pvondo` | ✓ | ✓ |
| WOLF | WOLFon | `Zfb5PTVfGa8AV6VxrTQJuP8CjMXFPMVkVVNpcAWondo` | ✓ | ✓ |
| WS | WSon | `ZpJpMhWKCr4m9ZzxApJJwDc5cHiHp2hG1RZdJyvondo` | ✓ | ✓ |
| XYLD | XYLDon | `wCr7YFeYDWyYSebsoMY75g8c9pguGeVB3rT6kYjondo` | ✓ | ✓ |
| YEAR | YEARon | `wxPFbh4dVrTWPGHHbVVeTHH7GK2uQwnTm5C8X3Fondo` | ✓ | ✓ |

## 3. xStocks on EVM chains the wallet cannot sign on

Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink → xStock Solana. Blocked until the chain is added to Privy. Same contract address on every chain.

| Ticker | EVM address | Chains |
|---|---|---|
| A | `0x933b254aed47bdc03b19cadcd0b0d4ca038d974f` | X Layer, Ink |
| AA | `0x6362767df5bf9d9b6c945d1ff5e2bf96188a1df1` | Mantle, X Layer, Ink |
| AAOI | `0xed242f35bf53ce7757c74ecb9e6de070157a74c0` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AAPL | `0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| ABBV | `0xfbf2398df672cee4afcc2a4a733222331c742a6a` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| ABNB | `0xc1566b43ee3d9f507c75435c5eea81de7e7515f3` | Mantle, X Layer, Ink |
| ABT | `0x89233399708c18ac6887f90a2b4cd8ba5fedd06e` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| ADBE | `0x16e0b579be45baae54ceddd52e742b6457a7fe12` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| ADI | `0xccc9e8d1182f64b15e350db929ff6c6f98ebea29` | X Layer, Ink |
| ADM | `0xe6d9b0127a5f742bc79af0b327d25624a9150c06` | X Layer, Ink |
| ADP | `0xb207a53f551bffaca2718911f30f86f888f42ebf` | X Layer, Ink |
| ADSK | `0x7320ff11b32baa599d44fc8c8ecb31c7932443e1` | X Layer, Ink |
| AEE | `0x0da1f9a13b0d65956e3cf34801445458d96cc8f4` | X Layer, Ink |
| AEIS | `0xf90653ea8c2f1dbd69c8ce6d4360a4c31d867534` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AEP | `0xce3ec6d03c17c35a814444e079bd6aa5a14387e8` | X Layer, Ink |
| AFG | `0xd45b9ffcf15744476e5e7b79d4266818177e1a34` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AFL | `0xfbcda977c2991ecfb3bf4d7af2848e5510081b8f` | X Layer, Ink |
| AFRM | `0xdb0245163fda906f27dc5813d2d2b51673c33bde` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AGNC | `0xc9fa9d22fd52a634f395260e921aa06044e19d09` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AHR | `0x8d53fb379e89d2e2d772a79923a0bd093a03a011` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AI | `0xf95823d1f58bd633cd51e407c20f8ce7f50becb9` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AIAGR | `0x8658e84fc8b5c21710902cdfe50f1385ff28b329` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| AIG | `0x2a78b1e0f391c8a2cc7ac092bca2dada939384dc` | X Layer, Ink |
| AIT | `0xda5b4b4c469bc34fe2493a980a2e017a4885b28f` | Mantle, X Layer, Ink |
| AIZ | `0x2d21247c1855d12a69024b596e7c630636dc82b6` | Mantle, X Layer, Ink |
| AJG | `0x63e3e2c8d59af0489a41ee899117138cd2e575bc` | X Layer, Ink |
| AKAM | `0x9d651601f24d162800b816b22bde370e9b277e7f` | X Layer, Ink |
| ALAB | `0xd64cb407fe4e76f5676ab656866f0e1de2ff4330` | X Layer, Ink |
| ALB | `0x94164391de9fa0204aefd36a863743544dfa4f31` | X Layer, Ink |
| ALGN | `0xef0c9de21450863f0f8b46f8d476f9ef8db69e39` | Mantle, X Layer, Ink |
| ALL | `0xd2acde8e0883fd38039d073ae69228c7e8e0ed0d` | X Layer, Ink |
| ALLY | `0xb5439db439a5a3cd33837331ffbf5fd62d24085b` | Mantle, X Layer, Ink |
| ALNY | `0x9ce59fc950eda062492ceca15f2a13467fc388fe` | X Layer, Ink |
| ALSN | `0xa4e2cd78c1d50cfd00b6606d7e0ffc54742fcbfa` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AM | `0x711710400e35283e7c59e9398006ac687ffd8fb8` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AMD | `0x3522513e5f146a2006e2901b05f16b2821485e19` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| AME | `0x0d9caf20e33fcb7adf6cb95c3f9bb012fdb2fd97` | X Layer, Ink |
| AMGN | `0xdcd6b813d01a45de8da9367b36cb02b2e570fdfd` | X Layer, Ink |
| AMH | `0xf751b35bb44f4b03b12262cef112fcaf0307f406` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AMKR | `0xf208153ba23df793b9a9a5ef1517cd4644d04889` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AMP | `0x2496da59f7b59801b862bb4667f0d4d7c2eb93f9` | X Layer, Ink |
| AMT | `0x26fa8748a658e51ebebdfbe2eeb813470f10c9be` | X Layer, Ink |
| AMZN | `0x3557ba345b01efa20a1bddc61f573bfd87195081` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| ANTAS | `0x0a4119a517726b418695caae6e4e6fdb07246f36` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| APA | `0x6006d2029f25549774d0684aa14b250e3e81c83e` | Mantle, X Layer, Ink |
| APD | `0x2488583fd85de034571f84609b978018dc72d3c2` | X Layer, Ink |
| APG | `0xab90d40660e6fd89b4560ef11fb938dfb4d7da02` | Mantle, X Layer, Ink |
| APH | `0x7848475161802da675c321b250e0b25658fdf96c` | Mantle, X Layer, Ink |
| APO | `0x38c49e8236242ec4dce135775c2a8d525830ffc0` | X Layer, Ink |
| APP | `0x50a1291f69d9d3853def8209cfb1af0b46927be1` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| AR | `0x70853c88915b95efaa7bb5c15413d3c841bfe807` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| ARES | `0x96180d4b7c607816eeee8d58228d05b009366852` | Mantle, X Layer, Ink |
| ARM | `0xd15140134a81d3718c87a2d5c17145d324d874a6` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| ARMK | `0x0b5409f293f78a290a7e8d63c70963e2c06d5e07` | Mantle, X Layer, Ink |
| ARW | `0xab24b29d230795fb14f37042b40d003fe7ff7c3b` | Mantle, X Layer, Ink |
| ARWR | `0x26e58f0d3c6e211d6e30d9f5a016c4883670acb7` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AS | `0xe3b8d0690b6d54ec272a728c780f3adda68f526c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| ASML | `0xc0b417e7f83db438631eb5e096684dd742e5294f` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| ASMPT | `0x5873ce319fd206789b7cf6c6ad3d17d803a10f1c` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| ATI | `0x9d05846ceb65e27052ad783181cf8364460b1fab` | X Layer, Ink |
| ATO | `0x93551be7e70231d9b8cdce24218805d19a924f79` | X Layer, Ink |
| AUR | `0xd5b5f0613f9f3d6a670eb32d59dd5bedbb444426` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AVGO | `0x38bac69cbbd28156796e4163b2b6dcb81e336565` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| AVY | `0x66aa8475a988006c6b9e6297b2d0ca6021017a08` | Mantle, X Layer, Ink |
| AWK | `0x12b4675e66d1c43ff8550ffa63251c6c2c99c2a9` | X Layer, Ink |
| AXON | `0x98c04f53aee02cc622ab49352f0165b4799afb84` | X Layer, Ink |
| AXSM | `0xce39e4fb8e9e415f60869a5ea3467091ae115e15` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AXTI | `0xce1c7dc7d320a5e11d8921c0124efea4b577c47c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| AZN | `0x5d642505fe1a28897eb3baba665f454755d8daa2` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| AZO | `0xb68396bb3d29447019f360e2106996fd23856bd4` | X Layer, Ink |
| BA | `0x5e5e6aa595f5ba2e12d3120810b9fe607735ac8c` | X Layer, Ink |
| BAC | `0x314938c596f5ce31c3f75307d2979338c346d7f2` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| BALL | `0x60143db3b316a95771435b5cf6a1d71b7a09bbed` | Mantle, X Layer, Ink |
| BAM | `0xd629f4cf39b225edcd94c075dd17bcf37fa2c068` | Mantle, X Layer, Ink |
| BANKC | `0xf758e87ca18824b767aa4f3ed58c188d3babe428` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| BAX | `0x957d422ab6dd484c01f84b40b5a0b00bcf742d09` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| BBIO | `0x1a7ad9dc7e1dc6873c7c47504aad8c99b86ce114` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| BBY | `0x44be932030afb9fccd22621f5f5f5c2fe72efc5c` | Mantle, X Layer, Ink |
| BDWAP | `0xd98fb2a0c8ddf4ec072fc0ba3bda4d38363f55c5` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| BDX | `0x83a53e205cd5dba6ca2eea5cb2345638279ddbbc` | X Layer, Ink |
| BE | `0xdcf5f4a677514c293474556133dcfd3276f5e998` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| BEN | `0xb100ee83b2f3e591c84354db63850677925b704f` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| BETR | `0x8cda4d1d08250ce22faf49879fddbd2bba55fcfc` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| BIIB | `0xb954c3c643050cb532a4082d3def7fc29eced300` | X Layer, Ink |
| BITX | `0xe1435b2f302edf42ae84a306a5e1948b270b6ccb` | X Layer |
| BJ | `0xa5e265e9a992eaecc06a6c4c787f73743cb01f35` | Mantle, X Layer, Ink |
| BKR | `0xac63197ead820a810141b942ebe593abdbb1d07f` | Mantle, X Layer, Ink |
| BMNR | `0xaeb681b69e5094e04d11bcef51a71358a374c3ed` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| BMRN | `0xf4c5ab39067a38b4e01b35d128f3d2bd6bc7298c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| BMY | `0x20641e4790423744b42d5af39c7a50bc1d815931` | X Layer, Ink |
| BNY | `0xb972542e747af613e8cf824a405ee92b6304397c` | Mantle, X Layer, Ink |
| BOCHK | `0x255eb175e5dd1a58e7996a6ec18e1d825ea168d9` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| BOCOM | `0x38c62f1e6afaa0b80eeb6f5c0a9df7cf7d6e07b1` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| BOT | `0x1f2c8792148e4dc81a86109504810f2d5f2f26e4` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| BPOP | `0x5866f125b00bf3d123586d26681362c110553262` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| BR | `0x44a81c9d99b59bcc19ee2b852ac2abdf81062869` | Mantle, X Layer, Ink |
| BRK.B | `0x12992613fdd35abe95dec5a4964331b1ee23b50d` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| BRO | `0x8b992e525990069bae4ebcf52cb76ca50358d5e6` | X Layer, Ink |
| BSP | `0x7796f4e23a62ef3653829c21032a9e24beaf4cf5` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| BSX | `0x5fe45d4b2cad6eb5ef6bda8626764817fdb4e940` | X Layer, Ink |
| BSY | `0xbe57c33d1278f5dbda142f328d805353b94aa6ca` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| BTBT | `0x22e1991e5f82736a2a990322a46aac0e95826c5b` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| BTGO | `0x60ae7d760a1c7b528c0384bc945fadf1438f47a5` | Arbitrum, HyperEVM, X Layer, Ink |
| BURL | `0xbbc5399873223b7b4aa877685e57837643e54ce4` | X Layer, Ink |
| BWA | `0xdeddf43e79fa035bd86d976751bfdae474a29580` | Mantle, X Layer, Ink |
| BWXT | `0xd66c91211925caf1dcf694adb5fc9b13ffa92a0d` | X Layer, Ink |
| BX | `0xc0b359593633c8bdb05cd838d6b23cef42ac7d03` | X Layer, Ink |
| BXP | `0xca7e36bee157f2de07610d331fd76d826e054573` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| BYDCO | `0x2d2b6cb9ee02535d1a36fdb1b130a488891b895b` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| C | `0xb9a403dc62154512c3b2b366aa2ca3e094ad3e60` | X Layer, Ink |
| CACI | `0x02a6f0539da50e2ef5365eea214495c5cd42f127` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| CAH | `0x1bb280d8702180860c03319ac920388bb77487f2` | X Layer, Ink |
| CARR | `0x46464de7ec96039cc22b58ebbcb718ed3e7b6957` | X Layer, Ink |
| CASY | `0xeed0831daaf44eec5fa82b067f1828f23a996024` | X Layer, Ink |
| CAT | `0x54d883064b634390c30b780d0cad761be8bfaae9` | X Layer, Ink |
| CBRE | `0xc7acc638da6a8f61559342a36bfb3ce8d5032cb4` | Mantle, X Layer, Ink |
| CBRS | `0x874c1986ede15f6520686652268e0d62d9a10618` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| CCI | `0x2e2d7cb3e0936ac6aa76bf91ec597986fbe63bfd` | X Layer, Ink |
| CCK | `0xd7b67b7fc787fbce0adeac16c2ccb1c8047d8cca` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| CCONB | `0x0ab16f6cf8df81e1b6b0a82cc2bdff21a7ff613d` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CDE | `0x769621695d9c1b8d1c88c9b973fcac6f2067a0a3` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| CDNS | `0x2219785c22c0e38c675515f0010e7443f0eb9487` | X Layer, Ink |
| CDW | `0xc191fc475a0a45ef598ff42e1ae72917582dbeaa` | Mantle, X Layer, Ink |
| CEG | `0x7636244bab612264e1b2dfd4ba6e26d0311b1eb7` | Mantle, X Layer, Ink |
| CF | `0xff0b421a304fac14f9cc1d8837e4c7f5d0792710` | Mantle, X Layer, Ink |
| CFG | `0x010d5e78a62879ebc58f04cb9eadedd73a4e43e6` | X Layer, Ink |
| CG | `0xd08e2086a3a2d49f0a7e7fc91a40a3d58e50ca4a` | Mantle, X Layer, Ink |
| CHD | `0x8a0d5deccd1193105b2ed895b4ed7542d54e7519` | X Layer, Ink |
| CHONG | `0x526c4252142f4d91eaca08bc36081fe788010c6b` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CHRW | `0xed6da309dd1e1c12b09d7e7f03282f9581850804` | X Layer, Ink |
| CHTR | `0xef0a450dc85989ca228fa7198e17c834218c5334` | Mantle, X Layer, Ink |
| CI | `0x40bf69f64ee34a535568be85e80e126c4282ecf3` | X Layer, Ink |
| CIEN | `0x9d18fe6c68e62e97faa14ef736879ed3b5449a3d` | X Layer, Ink |
| CINF | `0x600aa2917f0223ab6623ce8bf95e9bcaffd8499d` | X Layer, Ink |
| CITIC | `0x41778f4f36b2dd8fd27c55043154ba7a3df18d83` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CKAH | `0x285e1e3268557770f83083717e66a65250e9706e` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CKHUT | `0xcd8c9d447aacec3de5e3093003e218aa8a8af0a1` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CKINF | `0xfd09e7d3cf7fc3a3a5f1f89f80ec65794a0bfed0` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CL | `0x9d13e2a71d55497241aee64b48992a2ce3bbf98e` | X Layer, Ink |
| CLH | `0x7a1c7312aa5ab60d6ded33bb5cf23e1b15430b65` | Mantle, X Layer, Ink |
| CLINS | `0xd042f1c206e5857911732b7132044adfbec06a7d` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CLONP | `0x5eac3a8128627c67a33a3d3eaa12433cbd15c783` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CLPHD | `0xb859df8c25325083a71ac67fa83c8c285e50dce0` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CLX | `0x8e38da2ed94e3779da83075d8c73ea98fbf934f4` | Mantle, X Layer, Ink |
| CMCSA | `0xbc7170a1280be28513b4e940c681537eb25e39f4` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| CME | `0x388bd41aaf969d13e3538d62c051d08302a7fa6e` | Mantle, X Layer, Ink |
| CMEND | `0x88a8fa2cc310846f0a76fae93065b365b51b8334` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CMERP | `0x0877ef9820416fa01e4ec0c89bbe35855459c58c` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CMG | `0xdad1865dd327fd305df6ec6accede2b5faaec9ca` | X Layer, Ink |
| CMI | `0xaf79388d25a99c3806fc44e937b9ea3b503a9394` | X Layer, Ink |
| CMS | `0xd7c595a1c093bd21284e1acc036f37cdd429e536` | X Layer, Ink |
| CNA | `0xd41e61bfddfa78af89d82b3d1b3007899a1e3393` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| CNC | `0x65f3d5c5cb7989130da4f84dbdc8b431670b1745` | X Layer, Ink |
| CNP | `0x5c6dc244b258d71c55eee3be0c3cbb6b443cb73d` | X Layer, Ink |
| COF | `0xf6d5373b0cafc08da97ccb0a38db60c73494d586` | X Layer, Ink |
| COHR | `0x8bb9f6047997bf5fd679c6649833f8d89503ae6e` | X Layer, Ink |
| COIN | `0x364f210f430ec2448fc68a49203040f6124096f0` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| COO | `0x6655a43472c21583bd1590ab66fa670a27d7bb7e` | Mantle, X Layer, Ink |
| COP | `0xf50631342bb3b83cd2be267c11da3a97d803dc27` | X Layer, Ink |
| COPX | `0x89bab39d627a9e34f0dc782c53457e80ee8fb9d9` | Arbitrum, HyperEVM, X Layer, Ink |
| COR | `0xd7ed2c1a0264cf3967cdfdc698ebae895f66c856` | X Layer, Ink |
| CORT | `0x8b1c0548d402b860eaadf6da598f754e7ab60d1a` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| COSC | `0x6593131b9a950e00b7838194548a081d3037afaa` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| COVEL | `0x3427b17e44f8fca0e91981b7c15b40727fe4ad81` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CPAY | `0x4e30b8a21d1e8a5581e3226d8e85ed03fc1c4732` | X Layer, Ink |
| CPETC | `0xd658b561629ee87ab00a4b1be071f69ce6a282d3` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CPNG | `0x60cb8c81bdb4ae6e2bc66de8713b52c68148e5ac` | Mantle, X Layer, Ink |
| CPRT | `0x154d7c2a6c4e17037060c84c4132c86140ad0c74` | X Layer, Ink |
| CPT | `0x1fc9ecc975c1cc50a372634a5039f4f3b4180ac5` | Mantle, X Layer, Ink |
| CR | `0x8a51d83ebd03e381515724fb3493fdfd149710ec` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| CRAUT | `0xdb5727519fcb04d2b42cd55528bcce7378a05d65` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CRBG | `0x139bc1d061cc62be1c1f9ab7b2d7ce722e54cc9b` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| CRCL | `0xfebded1b0986a8ee107f5ab1a1c5a813491deceb` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CRESB | `0x0c6f997a246d4a2be703d389fb95a8b350d9ae56` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CRESL | `0x7198598c8db29708ed857ac5eafb62e0e5fafc8a` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CRESM | `0x2770481435cafc9003f1fab21170af7579dc9cba` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CRESP | `0x5c697e3cfd5a97a194a9a32f73ffc850cc86c02f` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CRM | `0x4a4073f2eaf299a1be22254dcd2c41727f6f54a2` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| CRS | `0x7fedac22a2e1369eb3d850cce752067dbb93588f` | X Layer, Ink |
| CRWD | `0x214151022c2a5e380ab80cdac31f23ae554a7345` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| CRWV | `0x16314d1032e6476c9451d1f02ba365a249ff36c7` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| CSCO | `0x053c784cd87b74f42e0c089f98643e79c1a3ff16` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| CSGP | `0xd5a68ad7413eacc211f2382f55bcbbcf8f30030a` | Mantle, X Layer, Ink |
| CSHEE | `0xdf1c0afa8adaba2c9fdbf5c0dd739d703ae037c9` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CSL | `0x77bc8f5aeacf2ded90307c9207da1746ca1e9241` | Mantle, X Layer, Ink |
| CSPC | `0x74f4f275d72b2c431a2c049ce46220a8b21f5a90` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CSX | `0x41d7f18d1967d20e13c7949b954c50ff697f40cc` | X Layer, Ink |
| CTAS | `0x671b6083bf2f77844dd61f4376a4fe900270c5e4` | X Layer, Ink |
| CTFJW | `0x9a301de98a27abdee0461dd1aa796427df5fb073` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CTINS | `0x76c29d9249430eb16834a6a28d1d1b1b437103b7` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CTPCA | `0x460e90e673298be0be403068437424500e3a2f7d` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| CTSH | `0x853c65ef470689195a52ffcb85874b901a181b58` | Mantle, X Layer, Ink |
| CTVA | `0x708e74a00c49ca0cbbf892ebbb9efde84e9844dd` | X Layer, Ink |
| CVNA | `0x3783c4704b2fb000b8426250661a3959441dec2c` | Mantle, X Layer, Ink |
| CVS | `0x6e6dabe27feb2e21ac6a8bc15f20f2878b146c41` | X Layer, Ink |
| CVX | `0xad5cdc3340904285b8159089974a99a1a09eb4c0` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| CW | `0x88829e4e48eb5e41a7eb0118603036b75f0c685f` | X Layer, Ink |
| D | `0x3ef11a28f69d7134c957bfe31995106d0e5c3255` | X Layer, Ink |
| DAL | `0x978a8ae09a7f7b5a39afb288bc2a63b4aa4feb45` | X Layer, Ink |
| DASH | `0xf38665a4a42a1e7eeb36a5f26d1757b788e64a4f` | Mantle, X Layer, Ink |
| DAX | `0xfe7b11d43cfd9fd6010f1b3f9cc86e5bcdb2bc78` | X Layer |
| DCI | `0x1bbae6c80e40b44bc36e63d592eece9440ad5c7b` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| DDOG | `0x84bb81e42fabbdfc7a760a19f73983da1bd90080` | Mantle, X Layer, Ink |
| DE | `0x6b530e7df5a66422672632ca1a3277c497f0afcb` | X Layer, Ink |
| DECK | `0xafd798910608fd531912f9262c2a5eb1ebe78e07` | Mantle, X Layer, Ink |
| DELL | `0x2782df1cc877f720c81b4f6568db64563f1d3aa3` | Mantle, X Layer, Ink |
| DG | `0xe4f827151471be4c2f0e5c754e74f89f3d6888c0` | X Layer, Ink |
| DGX | `0x14c7a3738fd283e04d1082db86f3410de2354e2d` | X Layer, Ink |
| DHI | `0xce50d7b79f1a4243754ccd4b4740547ecb54339e` | X Layer, Ink |
| DHR | `0xdba228936f4079daf9aa906fd48a87f2300405f4` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| DINO | `0x23889fa78da8e454e72f2b19bd331d19a27040bf` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| DIS | `0xb07f6ed1496aa9bb751dc3cb901328dc08a64ac4` | X Layer, Ink |
| DJT | `0x90216e923d43b8840d7164634aa9267313058e42` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| DKNG | `0xfbf32f87bd0eaa8c8bb290cf1c5650648a36aa18` | Mantle, X Layer, Ink |
| DKS | `0x8e2fb41b55937ea5f939723a2b9e4a55632fd8dd` | Mantle, X Layer, Ink |
| DLR | `0x9e350c07ab5bfc75f684dccb4d392403a1641d9b` | X Layer, Ink |
| DLTR | `0xf52835d4163e4f37547ddb40876578a2d6d9d319` | X Layer, Ink |
| DOC | `0x2b51b5162d39a20ae5ca52b89e5d12526d63e4dc` | Mantle, X Layer, Ink |
| DOCN | `0xed258844f20a0162d476d98cf370508088755c29` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| DOCU | `0x876ac27dbaa175411d53b269f70146acd1e2baba` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| DOV | `0x2181335979aff9af53c1805a3ede635629f392cc` | X Layer, Ink |
| DOW | `0x2e6ef35624eb900e7e537fc45f523cff49d274b4` | X Layer, Ink |
| DPZ | `0x14e7901b89158e80a953cfef3cebe065f9cb8eef` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| DRAM | `0xf44234dec21985feb41e37b86fda923cb046f114` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| DRI | `0xd80840f51367e5f22d29c2de161d86fe992ebf77` | X Layer, Ink |
| DRS | `0x4efb7f42a381a115fe375438e85da301d6fd1b71` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| DT | `0xd3a40e90234f9389a772868d3421ea4a26a048ea` | Mantle, X Layer, Ink |
| DTE | `0x573833074a35e5ccf1835646f0d4a15ced7527d7` | X Layer, Ink |
| DUK | `0xaf8c938647f517aec81638b90313c414b3f71087` | X Layer, Ink |
| DVA | `0xb5638d3ccf90d90b9ec38bd876d406f4f92df70c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| DVN | `0x384557a6946952b37aad045b189c3c1fe9f6fb53` | X Layer, Ink |
| DXCM | `0x67bd52640b0c14260f7732ae6f464ea59658cf6d` | X Layer, Ink |
| DY | `0xddbef1639261daa6f4d629bec8a5b9f831410cce` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| ECL | `0xe3b2e4a76489d00905c48794a383b5c7ddd35a34` | X Layer, Ink |
| ED | `0x8b0d5a46457f946dda728a71b1d97c841e720a46` | X Layer, Ink |
| EFX | `0x94d5e6d9d29ced7bc1a1226a35d7a9a8354186c5` | X Layer, Ink |
| EG | `0x8fde03e768f5e610e6e248db63456e1776d14b5d` | Mantle, X Layer, Ink |
| EGP | `0x8932858213007adb2119fbddbafcadf330dd0feb` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| EHC | `0xd2de202c1dbc8915ab431773d50a10a256da9b6c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| EIX | `0x7ea34b6f09724b2d831b081bf495e33075721b81` | X Layer, Ink |
| EL | `0x966a68d8093cfccc6d6e43acbfd19658a91ec133` | Mantle, X Layer, Ink |
| ELAN | `0xf5511d5c6453a9f9e8d98a7021dbd3f0dc6cfb3a` | Mantle, X Layer, Ink |
| ELS | `0x164514953adda392e2fa84f2b6dd38060b4e2d23` | Mantle, X Layer, Ink |
| ELV | `0x7e495deac439596903374651122dc3c0508b075c` | X Layer, Ink |
| EME | `0x063ee3dfc43993da6920d44b44348e6a283c6bb4` | X Layer, Ink |
| EMR | `0x53b4e3fbd431927e193ece6318e445373e34d044` | X Layer, Ink |
| ENHA | `0xe75aff5123d9de91a1c27167c6c01b1f5b1eab14` | X Layer |
| ENNHL | `0x450f1c155690a0f475f24c6f5fc685989a0dcb2a` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| ENTG | `0xfbe44afa5928d738c70198126e46ec7629e60d0c` | X Layer, Ink |
| EOG | `0x46a42b582723e670d6accf11f745890379234b53` | X Layer, Ink |
| EQH | `0xceb3f01585a4b8763fd2635cfd25e8bbfbf67193` | Mantle, X Layer, Ink |
| EQIX | `0xbb75cdd39e47a569e66162353544f86bcdfc4416` | X Layer, Ink |
| EQT | `0xde9ff7e79882ef488f5872941885f026bc566b84` | X Layer, Ink |
| ES | `0x28a3983afd8110a0e8143ef1f8a9ec23f4215edd` | X Layer, Ink |
| ESS | `0xba0312639c8d17006a551df6f47349739bf08d19` | X Layer, Ink |
| ETR | `0x408c30d5a587dc631af87245a01427d30860bed5` | X Layer, Ink |
| EVR | `0x8ab6a088c597f5ca7239aea70e51a5ace8228654` | Mantle, X Layer, Ink |
| EVRG | `0x6f881344528f4a7b2146ca97d4517353fef3e7c4` | X Layer, Ink |
| EW | `0xcbb0cd953871c8333f4b03aa1966b4abdf16aaf4` | X Layer, Ink |
| EWBC | `0xd49e31a21201a5c45ab0e8c7c0982a6c6fe5d45c` | X Layer, Ink |
| EWG | `0xed2bdd82366728c1f2a7e8b93c4dd4a58404bf65` | X Layer |
| EWQ | `0xebb35d5b5bf82203812e3c02797ef0cbdbb81146` | X Layer |
| EWU | `0x6c5287b4ea247031da9e375573e5d1c8a12938ee` | X Layer |
| EWY | `0x299c95eb52bfd5bc98d924bce17197b64864589b` | X Layer |
| EXC | `0x0a83469837ac8993a9f4f6582deb7dbf14e83f6d` | X Layer, Ink |
| EXE | `0x5590b5ade4ad486f929d05c4aecbc383d1210f55` | X Layer, Ink |
| EXEL | `0xda74bfe8d9b19fb3e5c5a7a827965735c5151a30` | Mantle, X Layer, Ink |
| EXPD | `0xd725f3cf4d1adba1bc0956689c64e8746a324ca3` | X Layer, Ink |
| EXR | `0x4d6a39b08d2abd3382b650117efa19741580d91d` | X Layer, Ink |
| F | `0x1f0211620dd867245f3bfceb6b5ff8e0403877bf` | X Layer, Ink |
| FAAA | `0xf51565240e667176c532db4139386e6a6e506d99` | X Layer |
| FANG | `0xad0772bf1f744e58bd2d65c5aa5e9681b924d052` | X Layer, Ink |
| FAST | `0x8d8595b2f7a8a402b021f4e3c5c8923effd3cb47` | X Layer, Ink |
| FCNCA | `0xaa05eff17edb2a99cf03e465fc3788ba273fad98` | Mantle, X Layer, Ink |
| FCX | `0x9f37aec0200892d5a9d612a7b5ec8f59c2719fad` | X Layer, Ink |
| FDS | `0x98b69f6e1770d4f34ebff27be8238849ce8e039d` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| FDX | `0x0ff554272f98f63f53fbf51285c54dba55104f3b` | X Layer, Ink |
| FDXF | `0xdc8c197c0c47649a5538f4e5969177a6b2dd8b0b` | Mantle, X Layer, Ink |
| FE | `0xb934888ce2a1ac898e7c0d07c5720092596d5727` | X Layer, Ink |
| FERG | `0xf4a34970405440b64aee269a2b43a5041b5b61c8` | X Layer, Ink |
| FEZ | `0xae6d61508125bc541e367a6a8b1f594ecc42f557` | X Layer |
| FFIV | `0x310e9d4efa5652e8e79a66f5563ad48b230a6024` | X Layer, Ink |
| FHN | `0x14c94ae4ffc0f772e614461c8160edbd055ae257` | Mantle, X Layer, Ink |
| FICO | `0x8b43fb77f5823f93470d37ac18909debef93ffa5` | X Layer, Ink |
| FIS | `0x41dbd486e11dc88ac498d740ed3d7a4985ce07f5` | X Layer, Ink |
| FISV | `0xc930c017431cbb6dc3672389fc5779843804c71f` | X Layer, Ink |
| FITB | `0x958454243c49831ef9d1e2d8e3837af75255c2c7` | X Layer, Ink |
| FIVE | `0xd920c8ed3f6d7ade6bba3c336f47aeb57ef93e89` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| FIX | `0xf52766f10dfc0052ede3477337be4c7e66dfd7fe` | X Layer, Ink |
| FLBL | `0x44314de3e69fd4c99fb638816b58ed2a85d466d9` | X Layer |
| FLNC | `0x4aaf56c5c9a04d6af855d3c963026d9e4bdd0ab6` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| FLQM | `0x16b8fef54489a0beb2cf09f6f16e4cd31aee195a` | X Layer |
| FN | `0xa83697f63962e780246290460c841c3afbef6527` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| FNF | `0x041895170558e9025f87815b8ce58b23ce57ad88` | Mantle, X Layer, Ink |
| FRHC | `0x857a7d561d6a25a38013fc111332339b3ea520a0` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| FSLR | `0x13a9f32457c6e921e5e2adac1d98c86838d1a100` | X Layer, Ink |
| FSML | `0x7e8c89a9b9b85029cab43280aabbed600d7e8d36` | X Layer |
| FTAI | `0x07576873f108b862663143628ae2437ef0f414dd` | X Layer, Ink |
| FTNT | `0x9a9a9463d115242ff134ad4bb0010a50ca1befcb` | X Layer, Ink |
| FTV | `0xb3a4f4325b9952804f5f0f74d1c65f4cb84c42eb` | X Layer, Ink |
| FWONK | `0xf3d04bc45c5ef090b46cabe374ae73c45b70b415` | X Layer, Ink |
| GD | `0xe2cb2ebad874f7c8afaccf7b1341332ffa20beab` | X Layer, Ink |
| GDDY | `0x63b0507283b2a58ce149396afefc92fa38ea587c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| GDX | `0x3a62b4259e5c2e2314e254b2c79ebaf5e57e8cf3` | X Layer |
| GE | `0x450d36a2b13df58f3ac374a4002dbcc177c99718` | X Layer, Ink |
| GEEL | `0x704d21fbcb769e6cb9f0ad9363c5fd739be1424c` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| GEHC | `0x5b9db83ed1cae97d9f8d21ea8a11606664da52f0` | X Layer, Ink |
| GEN | `0x1c59e4c97303e0c28bc79f097287af89b754cc63` | Mantle, X Layer, Ink |
| GENTE | `0x4d396c675ada9f74b9c92276cffd13a83b514093` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| GFL | `0x516be05b00cc2f897fd3f8bbecb54990d206658b` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| GFS | `0x477344c0f2973595693226568a89712a8bbded5f` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| GGG | `0xe5756e8ae45704384b39f58aa9b8be250a3a38bd` | Mantle, X Layer, Ink |
| GH | `0x218f4cf85ac26909a1b2a37205bd054f7dd0c11f` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| GILD | `0x5bff193f267052d62b2e1cf319ce8305936b1f03` | X Layer, Ink |
| GIS | `0xcbc77dc87548e75f2c1d823892fcbf6f49b81e40` | X Layer, Ink |
| GL | `0xf0fd4d023af01085dfb52628a5317f4c35a5b8b9` | Mantle, X Layer, Ink |
| GLD | `0x2380f2673c640fb67e2d6b55b44c62f0e0e69da9` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| GLPI | `0xdf4b5995b9520f6d8420c1e2d527951d582d67bc` | Mantle, X Layer, Ink |
| GLW | `0xdc12f19af085310e952e0a03b173faacddead8c2` | X Layer, Ink |
| GLXY | `0xf7f4fac56f012de7dd6adff54c761986b9e0655a` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| GM | `0xcef8a7008310a15b1b1489d88b0e6fe51329b05a` | X Layer, Ink |
| GME | `0xe5f6d3b2405abdfe6f660e63202b25d23763160d` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| GMED | `0x9aafe57dda4f5de83b644cbd97d2b45dc4e8672c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| GNRC | `0xdd9a9feb64be689810fb2db010ba701bfe3aaf5d` | Mantle, X Layer, Ink |
| GOOGL | `0xe92f673ca36c5e2efd2de7628f815f84807e803f` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| GPC | `0x17b5845b2ca231d8c59696d2abd378e80234f25b` | Mantle, X Layer, Ink |
| GPN | `0xa6c7e611dbf501c949bc80fef3c55c6900463b83` | Mantle, X Layer, Ink |
| GS | `0x3ee7e9b3a992fd23cd1c363b0e296856b04ab149` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| GSAT | `0xf0938b2dfec267f439b55dff0523fbe741f95b02` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| GWRE | `0x7d72510babc131d74440392c0f249aaa2bed3e7f` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| GWW | `0xbbd6381e94b0c1e036ab50ae3271256bca0c264e` | X Layer, Ink |
| H | `0x634fd9cdab5444813630b190eea1f477ff367f4c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| HAIDL | `0x19a04945109738c9b8f936b2e3277c82fee707f3` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| HAIER | `0xd31abff8c6c3975e40e44b0299b3d5b358ab0a82` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| HAL | `0x371c1bfc134e750fe349000aeddf4086c2227ab1` | X Layer, Ink |
| HALO | `0xcde01af7fbe0d7b8526252320d7dbd183566297d` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| HAS | `0x63fa75424a1cc95bdfaf5aa652b70ab867c385d5` | Mantle, X Layer, Ink |
| HBAN | `0xdd21daf8f0bf0a39c9a113a617d6aee3fcac6655` | X Layer, Ink |
| HCA | `0x83a6f6065a096fa6e365d4d1fc136d5c09f4b2bf` | X Layer, Ink |
| HD | `0x766b0cd6ed6d90b5d49d2c36a3761e9728501ba9` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| HEI | `0x88b195ab3db3f3f6001ba231737041bf6a9ae94b` | Mantle, X Layer, Ink |
| HIG | `0xe2a85396fe2c2dc1ea57e97d93596334a40a8515` | X Layer, Ink |
| HII | `0x0062331a5a1627704b912bc5299bb604ea3ab825` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| HIMS | `0x55600dfb3943a2db1a49b250e1e9114e4ad2174f` | X Layer |
| HKCGA | `0x09f7b7eb4256d96be07f6bec836bc65ec5341317` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| HKEXC | `0x64c1c1a6453abb3ebbfc69e3e8f8e75953abd46a` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| HL | `0x3965a40f56f166bee144a110ffe44ae452623e19` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| HLT | `0x2cc707fabd22b802b205d7cb2fa792d12a5e19f0` | X Layer, Ink |
| HNDLD | `0x7633948088f0c17aa60ca02f6920b9dcfe0f9f7e` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| HON | `0x62a48560861b0b451654bfffdb5be6e47aa8ff1b` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| HOOD | `0xe1385fdd5ffb10081cd52c56584f25efa9084015` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| HPE | `0x9bcaaeab34fef9bcffc7a99c81c9bd15a2d299f1` | X Layer, Ink |
| HPQ | `0x050fec51850555731caf24831e3452293669e87a` | X Layer, Ink |
| HRL | `0x51494064481cba017ba920bf1058933e7c6a1bb4` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| HRZRB | `0xf88b87d748005f91af8cebeeb36cd8982d1342b0` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| HST | `0xfcbd9b46e71b627798b5d175047f0c46d30006cf` | X Layer, Ink |
| HSY | `0xc36c8893e54c9a0a1029fb981face1fc5613b4e9` | X Layer, Ink |
| HUBB | `0x0e59950494c2adcea8b974cd6777379d9a758665` | X Layer, Ink |
| HUBS | `0x5b58319888c70eec5880f513240b365243562df8` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| HUM | `0x8d6911bbbaf793f7924bdef62e96212cb27d0102` | X Layer, Ink |
| HWM | `0x013cd7ea7e427a7c57c9f3d5994e62873420fbea` | X Layer, Ink |
| IBKR | `0x8563a53804f4a195fd2c960a8d5e16c997c394ab` | Mantle, X Layer, Ink |
| IBM | `0xd9913208647671fe0f48f7f260076b2c6f310aac` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| ICBC | `0x518b484d827cc7655eec821d00cd2ae3ee4c958c` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| ICE | `0xde916b8089cbd5e52551bd933c3ea2ea5c903465` | X Layer, Ink |
| IDXX | `0x1fb76285f9c1a9410d4d7afcdb57ad7c98d62c68` | X Layer, Ink |
| IEMG | `0x6a668332825450acd2e449372057d31b3de16a1e` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| IESC | `0x9a1c32b87d0367daac48f784e480e14d66cea8e5` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| IEX | `0x4e89f60ccabce537970902e9d47bf57076235749` | X Layer, Ink |
| IFF | `0xdfae653d721d8cbfb7ff7ab1dc56693cdfb480f5` | X Layer, Ink |
| IJR | `0xaa28cb97d7f7e172f54dee950743886d2d65447d` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| ILMN | `0xfba79af741b68c0be8479f1d081572081ce1c0e3` | X Layer, Ink |
| INCY | `0xe0124233d9e93e85a687b6849711cf063cce7e65` | Mantle, X Layer, Ink |
| INDI | `0xdf4e8de684eab404a46af6140369d7905f3f2821` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| INSM | `0x82843ca8e5ec457f4710ef2d22ff0993f49cf406` | X Layer, Ink |
| INTC | `0xf8a80d1cb9cfd70d03d655d9df42339846f3b3c8` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| INTU | `0x714b99933ba569e3982e4381990c354410f21a50` | X Layer, Ink |
| INTW | `0xf9afa9dacbe613696e2747c29b930a51ada284e5` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| INVH | `0xd14a389b92d2097046325935f2299b8613543b00` | X Layer, Ink |
| IONQ | `0x7dcdbb780db10a9a0f8d2a0b6ab00f02b1974df4` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| IOT | `0x267a0a7ddcf0a7802fea1cd806f4ffc311a3cfa9` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| IP | `0x192725363346a04b5ac64e7d379e57513caa808a` | X Layer, Ink |
| IQM | `0x35b8bbd1eb42bb2b5b4894d0fe87b2812442e186` | X Layer |
| IQV | `0xad60f53050e65f8fe76ee9624e4f9e0f2c529d23` | X Layer, Ink |
| IR | `0x9e76eb9ac9e3978a3e4608086e555d443f14e43c` | X Layer, Ink |
| IREN | `0xfbfc1fd14eec970276c8a3bf5e6131cd751cc0b9` | X Layer |
| IRM | `0x25a98a66a3c667afd37aca01fba1583329fbf072` | X Layer, Ink |
| ISRG | `0x2f8eb54f81898b40adcf8ce3d415dda9372015d7` | X Layer, Ink |
| IT | `0x4aafeaeeea18dc613be2ec9a057e64a1df2cb6dd` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| ITA | `0x375b9f00a83132cabcda7abf2bfc87c14f7ac324` | X Layer, Ink |
| ITT | `0x2318c8a06a522572604fb0247827b8dd9c5681ce` | Mantle, X Layer, Ink |
| ITW | `0xa747dd8021e8d40967b2e561cc8ccb12e4f629b9` | X Layer, Ink |
| IVZ | `0xb3c2e973d85deec0ceed18fa13b02e6a1a1bb60c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| IWM | `0xdadfb355c6110eda0908740d52c834d6c2bcddc7` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| J | `0xc895a27f05a15db9b5ad980ee669102160e4394f` | Mantle, X Layer, Ink |
| JAAA | `0x3bf2e3be4a829bb3a5f5be450ae4c8eb3488da71` | X Layer |
| JBHT | `0xd62ae2c0fad3d7ea3671514f0a8f0fce31e0653e` | X Layer, Ink |
| JBL | `0xb7276f00d9cf51e52234f4ea85accec591a62ade` | X Layer, Ink |
| JDHLT | `0xb8f7522b9fcf732cbdff64e9dfac91054fb0a29d` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| JDLOG | `0x069c5dcacb4bab9f1c353b7a1dab50e7f2ba57e1` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| JEF | `0x215f08575c1033c171563e64923e70a050310055` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| JKHY | `0x10ef8902319697c91ff513ece57c23996a5c254f` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| JLL | `0x958cde73ca93020050c6eb8677b98c141bb575b2` | Mantle, X Layer, Ink |
| JMKE | `0x97fcf4dd5275ab0de96420cbe36e4c947d5d8edf` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| JNJ | `0xdb0482cfad4789798623e64b15eeba01b16e917c` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| JPM | `0xd9fc3e075d45254a1d834fea18af8041207dea0a` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| JPST | `0xe49922893496b17ac12fdd7c74720a92010d889d` | X Layer |
| JTGEX | `0xa21a2c0d078507cf4cb67e06deb301e8ad478770` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| KDP | `0x657b8c17c3fce7b5c3390aeb41105544f1bd4481` | X Layer, Ink |
| KEY | `0xcbbdab0ea8b230ddf66dae0ea8b04a14d467fed7` | X Layer, Ink |
| KEYS | `0x9c65f20b3e47ff274b241f6577ecaffa3e0dc593` | X Layer, Ink |
| KHC | `0x89270a1931de4405db73e4364f2882b6f010c32b` | X Layer, Ink |
| KIM | `0xb8d2d59232de999cc07b99f119a4f155e067d049` | X Layer, Ink |
| KKR | `0xae50d2a8ceee4c69c53266f0f966afe481ab112d` | X Layer, Ink |
| KMB | `0x518b9f5aa6e8ce40b0242f6c48e3947cb4255f3a` | X Layer, Ink |
| KMI | `0x52b950de3c686c464161d9edc8ea9f877bd3997f` | Mantle, X Layer, Ink |
| KNX | `0xe89de69f13e1e732b26d5dda2c3f32d6011ec387` | Mantle, X Layer, Ink |
| KO | `0xdcc1a2699441079da889b1f49e12b69cc791129b` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| KORU | `0xfe9e8fcd0990c9170254fe1d3c28f5cd730cd03b` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| KR | `0x53b3dba374bf852a18bc38ceb620b9f68abe0ab0` | X Layer, Ink |
| KTOS | `0x2efc8e610632cf9c483be6628f674a3d08d37a7f` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| KUAI | `0xfa8a6a57fc83e416cf45b04b7b92b4f48da9e7b8` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| KUNL | `0xc90373be639c4e8f18cd983ba610f00bf162e4e0` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| KVUE | `0x920ecdf6cb715424ff6bd609744721e4a6bac0b3` | X Layer, Ink |
| L | `0xb6490a926382c1dfa3be7fdb4281b1c3080a501d` | X Layer, Ink |
| LAMR | `0xc15563bab6e49addfe8a5fc80c2058d9f94d6860` | Mantle, X Layer, Ink |
| LAOPG | `0x6f6c13db193bf319287922735510be16b595831b` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| LDOS | `0x080bce6ba1cbed26d071df86eb4cd3a627e283dd` | Mantle, X Layer, Ink |
| LECO | `0xfcd20501af3268360625431aa677c2c8607a1067` | Mantle, X Layer, Ink |
| LEN | `0xfbb16f9b1d1de8a26220688dbca936c05f5a67c2` | Mantle, X Layer, Ink |
| LHX | `0xe4c07cd434516bca3eb7445f6ca646f877682bfc` | X Layer, Ink |
| LII | `0xfb7cbf1ec71e07f9eb2566b8cb3bc43a528f18f1` | X Layer, Ink |
| LIN | `0x15059c599c16fd8f70b633ade165502d6402cd49` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| LLY | `0x19c41ea77b34bbdee61c3a87a75d1abda2ed0be4` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| LMT | `0xbf3735196a77b62d0d9a52e2d3a70f667f76315a` | X Layer, Ink |
| LNG | `0xdce993f8a6dbce7f27434874f5dfe9a8d58509c9` | X Layer |
| LNT | `0xcefbda1e8cda85b4a9d066496b1989d63413b289` | X Layer, Ink |
| LOW | `0x391470973adbbbab50ec69be24918ce6b84399d8` | X Layer, Ink |
| LPLA | `0x287021807476d1ae3df547de9516314c98d96e75` | X Layer, Ink |
| LSCC | `0xfe1b0ea3111e4fc3a0eb89034c7cea1482f95c62` | X Layer, Ink |
| LUV | `0xabaa0db03eab027bf40bc3242935395aa1f29dbb` | X Layer, Ink |
| LVS | `0x13326eadd0f8323dddf0522f4a71993bf21b0d05` | Mantle, X Layer, Ink |
| LYV | `0x0d1b572cec79716fb9356696ba0239c9ce48dc8e` | X Layer, Ink |
| MA | `0xb365cd2588065f522d379ad19e903304f6b622c6` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| MAA | `0x4fe141616da62b8633efac1935dd6662c25a6538` | Mantle, X Layer, Ink |
| MANH | `0x89d657e98e08c7585304024d5c786b96e8ed275c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| MAR | `0xb0c14176d72b47e962286da1ce49d49996c5f0ac` | Mantle, X Layer, Ink |
| MARA | `0x9d692bffef6f6bedf4274053ff9998efe3b2539e` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| MAS | `0x5d8ca21519abd2f3cd3cfcfe659b71d828357ad9` | Mantle, X Layer, Ink |
| MCD | `0x80a77a372c1e12accda84299492f404902e2da67` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| MCHP | `0xc943e8d7c75ed4ab4e3f52df0f0573b83df5f046` | X Layer, Ink |
| MCK | `0xbaf3a0f945c0fe1963b80950486e0ce4827b3a1e` | X Layer, Ink |
| MCO | `0x90424a0398141599a27cff5938a6a721c51a09fc` | X Layer, Ink |
| MDB | `0x94a984253ecd65c1fabd35dba3cc6bcbc86b8795` | Mantle, X Layer, Ink |
| MDGL | `0x9e90ce16085ea1c58ad8689948c071c8799bcec5` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| MDLN | `0xd5859517180e639d50003fdb434e690ab1fbd21b` | Arbitrum, HyperEVM, Mantle, Ink |
| MDLZ | `0xc567ec4e62c80cc60454d24456e45de0abc36243` | Mantle, X Layer, Ink |
| MEDP | `0x3400f8b9852537feadc778f66629d7b5002593e2` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| MEIT | `0x0024af2ca56e822ad487c0bedc52a82028a55f86` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| MET | `0xd5377b7aaaad0651f92fc3cebd504498f88b9a2d` | X Layer, Ink |
| META | `0x96702be57cd9777f835117a809c7124fe4ec989a` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| METC | `0xc8c119606d13c780840b8ce48ed4ad8f3bde42f5` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| MGM | `0xd67019c50d6c26da108eb6327b100132177ceccd` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| MIXU | `0x8fa39ff32b316e2296630aa05bdd6a4a2e4b7598` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| MKC | `0x5d0c5f0845c4b45c4a0c0e88463d3d09ce6fef44` | Mantle, X Layer, Ink |
| MKL | `0x5f46cef6715bd8fc87e66e6890488e5af888f128` | X Layer, Ink |
| MKSI | `0xed78e87be099a1adf584ba5e41576786b1b490af` | X Layer, Ink |
| MLI | `0x4623de3596f4688cb5d1087f2e57efe36f81fd7c` | Mantle, X Layer, Ink |
| MLM | `0x5b95cad920f52ca0bf8892da1c7fe8e3a9f7ffae` | X Layer, Ink |
| MMG | `0x8387d2580e874c07a4074ea1bb4355e2eaa513ce` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| MMM | `0x707c6bc22b6cf83b930b0a68c3bb20a94836de71` | X Layer, Ink |
| MO | `0x933f92c009009f0ae2912bd8f42a2fe8d04dba6b` | X Layer, Ink |
| MOO | `0x06a0138f8c3e5110fd98e34a4473fb08f1304b87` | Mantle, X Layer, Ink |
| MP | `0x75d3c07dce9f1424dce574f78242e7ef1696b8a2` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| MPC | `0x358aad57a91c3b78e6b07fe4d0f0f03d0f6ac7e1` | X Layer, Ink |
| MPWR | `0xf78e8b9441fbbfb674d35101df0658d88b3bb33f` | X Layer, Ink |
| MRK | `0x17d8186ed8f68059124190d147174d0f6697dc40` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| MRNA | `0xefd30445a4ec1f4b3e0a6f4d9bdbd215f805047f` | X Layer, Ink |
| MRSH | `0x01a1bdbb233f23adbb259780e86448a88b9ebfb0` | X Layer, Ink |
| MRVL | `0xeaad46f4146ded5a47b55aa7f6c48c191deaec88` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| MS | `0xd8cd1c1ff337b2d4dc61b70aa8006e0eba401f58` | X Layer, Ink |
| MSCI | `0x9b58e45c3177e3466f57ef73e265ad98ac40f823` | X Layer, Ink |
| MSFT | `0x5621737f42dae558b81269fcb9e9e70c19aa6b35` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| MSI | `0x511570341bb0077d837f734ff554c19c8e53de57` | X Layer, Ink |
| MSTR | `0xae2f842ef90c0d5213259ab82639d5bbf649b08e` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| MTB | `0x92a5476d0b1897ef77de0dea72e75c616b8b55d2` | X Layer, Ink |
| MTD | `0xce3e6a3b988d27aef0a68c34589dc06e3e2a07cc` | X Layer, Ink |
| MTRCP | `0x1a1a1459bebba0c9f64a9005fc056d258bb2f0e1` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| MTSI | `0x8cf75f3f4d179b6bf28049cbb9181ce35b268a0f` | X Layer, Ink |
| MTZ | `0xcd1f04e13a903fc20840b6166610954baa8bd533` | X Layer, Ink |
| MU | `0xf6a873bae4ba1b304e45df52a4b7d176e1c6a8c4` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| MUU | `0x485012aebb4827b01cf307a055406c90f3ce19e5` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| MVLL | `0xd4272b4d50ffed57da20c02ab6d3ea3324bdcae2` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| NBIS | `0x0361d9e8a923d0fe9b8877d9bc9f38abffb46f74` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| NBIX | `0xbb398dd3ed4050d222e5853a9872646a81e8affe` | Mantle, X Layer, Ink |
| NDAQ | `0x378958e63e196e29047db1f9899b1c3b52375cfb` | Mantle, X Layer, Ink |
| NDSN | `0x12e714e27ab36fc439971d2d66f641342eb33f4e` | Mantle, X Layer, Ink |
| NEE | `0x838724754537372051fca62302e346355c7cb4dc` | X Layer, Ink |
| NEM | `0xfb4129a6323223956f789108c16be8bd619ea17e` | X Layer, Ink |
| NET | `0x995db25f900e38851cf4e67a05960e66f774530d` | X Layer |
| NFLX | `0xa6a65ac27e76cd53cb790473e4345c46e5ebf961` | Arbitrum, HyperEVM, X Layer, Ink |
| NI | `0x8df96a99d1d37c086ec43a76ab01b0ce5b05a804` | X Layer, Ink |
| NKE | `0x7c5e9e93ea0f8fe94ea94eb6283f200ba0b72be0` | Mantle, X Layer, Ink |
| NLR | `0x238c2306b77a0c33ff609e72f89bf7e1323a9999` | X Layer |
| NLY | `0xfa5cb298ac2eaf852699bb08309dc6f701de286f` | Mantle, X Layer, Ink |
| NOC | `0x95462c2233313d756fbfeb5f1fd0f7433abd3e4c` | X Layer, Ink |
| NONG | `0xeaf8166813d9739b6743e5156758ca0064969973` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| NOW | `0x47c789e2a8ed186ef3dfc91814e726126fdbed60` | X Layer, Ink |
| NRG | `0x43e9d4eb66e0a3bf9f9ce65e71982ec3215406de` | X Layer, Ink |
| NSC | `0x2aa0089f315da3cdbb6d154b55f909d628c08ef8` | X Layer, Ink |
| NTAP | `0x662b4e85462d7a293b70d47292cd10113be6cf63` | X Layer, Ink |
| NTNX | `0x12c9220c70d6997c0b23f6b0b98f29ae1c99e42d` | Mantle, X Layer, Ink |
| NTRA | `0xac747963ef64d40608232b0dae40a67aac2fc6a5` | X Layer, Ink |
| NTRS | `0x7af65f7d62a3b518b59064a74143b3ee05c4e3e9` | X Layer, Ink |
| NUE | `0xa529581a6542759be4efe1ecfb9354d5796425d6` | X Layer, Ink |
| NVDA | `0xc845b2894dbddd03858fd2d643b4ef725fe0849d` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| NVO | `0xf9523e369c5f55ad72dbaa75b0a9b92b3d8b147e` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| NVR | `0xd580bec1fa67535a889bb25114635d4f1e739ba3` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| NWG | `0x4c543cb8aca9f7eb28f3f3b6796cd2102f6ec0e6` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| NWS | `0xc31bc46de7750a61da61a16de55777c0ce2d62be` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| NWSA | `0x44028a82cead1efaf12c43dd41caf14877872d84` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| NYT | `0x64e311e3de5b2badc013e771fa99ca0d51c5cc0e` | Mantle, X Layer, Ink |
| O | `0x96306a74f357aa25aa89bb2e6cf90bd860481ada` | X Layer, Ink |
| OC | `0x16c283ac8f4789fb3d707308e69fd96ade45837a` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| ODFL | `0x488b7f10d6af0d5da18e758bd138e82b079a17ad` | X Layer, Ink |
| OHI | `0x2371b7e6c0a0f56aa81792a1b8f3fdbae6e8a3fb` | Mantle, X Layer, Ink |
| OKE | `0x70241e3dfdce23110cf6557a4bf1682de4c19f44` | X Layer, Ink |
| OKLO | `0x4b0ee7c047d43ca403239f28f42115bedb7c0076` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| OKTA | `0x46e75757bdd40f3be9f6be392cb233e8772d946d` | Mantle, X Layer, Ink |
| OMC | `0x648face8da5b4803ea902e74b5a41389a1d995ea` | X Layer, Ink |
| ON | `0x8dd3d692a2fcff0aec09eafa7633f52c36a312fa` | X Layer, Ink |
| ONDS | `0x50343212d7aadd7a104dcc7ed751514aa174d9dc` | X Layer |
| ONTO | `0x2641f4565926c1692b057cc2d6ef7ee5ee7049dd` | Mantle, X Layer, Ink |
| ORCL | `0x548308e91ec9f285c7bff05295badbd56a6e4971` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| ORLY | `0x04a396f4a6eb4c485512a2b53d444cf173cbdba4` | X Layer, Ink |
| OTIS | `0x2cd4e4cc2cea86e3f1ac26dd4d4855d468833dd3` | X Layer, Ink |
| OVV | `0x9f2327d8e3e6db28afc34cd9a46cfcfd3b014b37` | Mantle, X Layer, Ink |
| OWL | `0xebd96effc88cef240a35d8223008a7f788695608` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| OXY | `0x7758b37789015b5e8036e44f82de5f4871e648bb` | X Layer, Ink |
| P | `0x982b371bf69683065f2a32a4cf785751272aba9d` | Mantle, X Layer, Ink |
| PAG | `0x665c220ecd70f390a61cb5149336461438c2827c` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| PALL | `0x05473cea3774d898c7b6dda21e1876d6bca7277b` | Arbitrum, HyperEVM, X Layer, Ink |
| PAYX | `0xcd3da7bfcaf214cbabb74fcf00d40952f83646e8` | X Layer, Ink |
| PCAR | `0x649209bbb1b5b876c2aeb6cf7fd46c1679bd4069` | X Layer, Ink |
| PCG | `0xf2b72c4b56ddad85216eb881186a6719e44008f0` | X Layer, Ink |
| PCT | `0x667d0001065df1a94bc19e54497e9aa6cf6b6dfa` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| PEG | `0xb069e78610b5b1acc91b443b74a50a5e935d10f1` | X Layer, Ink |
| PEN | `0x5151c42f8cadf65f9fe16d90274bb721092dd2d7` | Mantle, X Layer, Ink |
| PEP | `0x36c424a6ec0e264b1616102ad63ed2ad7857413e` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| PFE | `0x1ac765b5bea23184802c7d2d497f7c33f1444a9e` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| PFG | `0x8941fcc07e74d6a29b083f066275a9404cd8378b` | X Layer, Ink |
| PFGC | `0xa77d88b4c383042b0c1dc4d72d9d2ab21e30d44a` | Mantle, X Layer, Ink |
| PG | `0xa90424d5d3e770e8644103ab503ed775dd1318fd` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| PGR | `0x75b6dcd603314bcd8b3683e526d63193cf7d7bae` | X Layer, Ink |
| PH | `0x8c0d35c89598da21114d28248c0d1324be04ecf0` | X Layer, Ink |
| PICC | `0xb97b45ec03fe0443e94e7d72512ad4df120c33be` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| PICO | `0x8bd17230466a8c04f569da2d8eeea6029e978a48` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| PINS | `0x85093041471382fe01517ab00ce897d7189db5d3` | Mantle, X Layer, Ink |
| PKG | `0x705a0c4d463418bd371d496c447e6ec497a47876` | X Layer, Ink |
| PLD | `0x54fefa2838f7dc972b1a08b41a48328875c84abc` | X Layer, Ink |
| PLTR | `0x6d482cec5f9dd1f05ccee9fd3ff79b246170f8e2` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| PM | `0x02a6c1789c3b4fdb1a7a3dfa39f90e5d3c94f4f9` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| PNC | `0xd249b28fc6c3e4c8879b93ba38f19dcdebbe5141` | X Layer, Ink |
| PNFP | `0x75ed2324543a3a1d8e1b5339d91c2598cdfa1f94` | Mantle, X Layer, Ink |
| PNW | `0x9b258ad07b0e90faacc0c6bb10413e10a30bc4cb` | Mantle, X Layer, Ink |
| POPMT | `0x3a0a47a9c2713a7049d1052cc8ebd39c41570580` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| PPG | `0x4520da6eaaab5102167b95f639c21234d7cda7b0` | X Layer, Ink |
| PPL | `0xc63d34f782216eec696adf8ea100f159d8f77d1f` | X Layer, Ink |
| PPLT | `0x8e9e4a8d7f1c65dcb42d9103832b27e75946055d` | Arbitrum, HyperEVM, X Layer, Ink |
| PR | `0x430bd46defc33d14ef23ae8ae4501871db375959` | Mantle, X Layer, Ink |
| PRAD | `0x5bab03661f4ad8295df74e914275b31a260e58a9` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| PRU | `0x42e49d4da0b73edcca7d12ea35c2ee136d9362af` | X Layer, Ink |
| PSA | `0x7dcc5dfae3e6fc34193d04276bd371701d09ed3f` | X Layer, Ink |
| PSBOC | `0xad019b4c76ec4efec0ffb81681dbf07391cd29f2` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| PSX | `0xadad6f009a825c62fca74a643addae151506593f` | X Layer, Ink |
| PTC | `0x2ef2ba84ff90afd78f6687d7072d624549c1dd22` | Mantle, X Layer, Ink |
| PWAHL | `0xf2c14cb87dd6d484e6298191f2bd0aa57f37ec60` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| PYPL | `0xf706585e7e8900be0267bee3b9a2f70835ec6628` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| Q | `0x841446d55449b4ef92fd6bab70fa6ba69ec00bf1` | X Layer, Ink |
| QCOM | `0x2d73ed3b4f20bd8f9abe92786740ba79e9fa0ef6` | X Layer, Ink |
| QQQ | `0xa753a7395cae905cd615da0b82a53e0560f250af` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| QSR | `0xc6437a260bf2b7e9d9e402b2ef7e9a84d3622046` | Mantle, X Layer, Ink |
| QUBT | `0xccf2c9bf9e97554080bf899105454419bfe8c930` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| QURE | `0xda1e4f408ab7563fddd342d40247913585c14bc0` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| RBA | `0xadd72796327eba25558ee932bb4d39039c268a66` | Mantle, X Layer, Ink |
| RBLX | `0x5d8da1417e3565eb02c9ca8cc588be5d8f65b1c5` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| RBRK | `0x9d45fde5bb853066963884b2532204ccf536965f` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| RCAT | `0x1fd2d7adac24b3f9552bc967bffcdce3b92d31b8` | X Layer |
| RDDT | `0x52ce422d81e62a2c4bb87653d66f2235c73b152e` | Mantle, X Layer, Ink |
| REG | `0xd1d32d11319471c4c0b00f95ad34cf0855184dd2` | Mantle, X Layer, Ink |
| REGN | `0xa618682a3281073acc2a15a09093682cb4134d7d` | X Layer, Ink |
| RF | `0x94335d09e6c8c72810012cdf123d050b4ee9876d` | X Layer, Ink |
| RGA | `0xef9a55161e5db35493e6d7f978d0e37fb96c0635` | Mantle, X Layer, Ink |
| RGLD | `0xc78b78873a1febf6f511a336b15c08182be67603` | X Layer, Ink |
| RIOT | `0x6ac47387f0a2798df4c4ee5bb31ab9517ac97cb8` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| RIVN | `0xe6a12d72ab88191147158f0d4cf3f614fc6441bc` | Mantle, X Layer, Ink |
| RJF | `0x53d229c54c35f8b77bdeb348e071ddaeac74c9dc` | X Layer, Ink |
| RKLB | `0xe17ce7dd2afb6da3488fd9ef2558523d569e17b4` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| RL | `0x858364eff838f2efa51a6ba51eb7e4a7697b3c2e` | Mantle, X Layer, Ink |
| RMD | `0xeb158d6532f16c3e6c137cebfb47dcf7a706181a` | X Layer, Ink |
| RNR | `0x69f6cf3bfc4e038c4f303a7368542697fa4c62ae` | Mantle, X Layer, Ink |
| ROIV | `0x28999e33c4c3a4576f52a5311c860c7010fc6013` | Mantle, X Layer, Ink |
| ROK | `0xe4f484e5ca6d6f06a5e5b8c9d2870921e8fbc814` | X Layer, Ink |
| ROKU | `0xd00cbf0e9eb52a446814ff0becf39d1cfd684a3d` | Mantle, X Layer, Ink |
| ROL | `0x17d4c17b892b663b24df264200434c28f6f5e5ff` | Mantle, X Layer, Ink |
| ROP | `0x0bf897240c444ced24cf8e18cb76700b3596d944` | X Layer, Ink |
| ROST | `0x4b3f9028dd0d64d1857bdbab1a27314040cc7188` | X Layer, Ink |
| RPM | `0x4f59465f8a978b1212475f605b444b42f794ba91` | Mantle, X Layer, Ink |
| RRX | `0xedf9acf668012a016a5d614a638c17545102aec5` | Mantle, X Layer, Ink |
| RS | `0x7b2f4c88e5c990833e6c0af33372f967af80fc83` | X Layer, Ink |
| RSG | `0x24ddc68f76b8ffe95dd1f4763aed201a44a846d9` | X Layer, Ink |
| RTX | `0x5884f1e7c69be620f0c0ff218e43c9a898153b21` | X Layer, Ink |
| RVMD | `0xa77d35039b95c50278477f393eb6c4edd3811dbb` | X Layer, Ink |
| RVTY | `0x5ceff2729e1873d2d45e9e51745b91ef8d14a405` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| RYAN | `0x09ab6d34642be26e346b52e392874150507f5ce9` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| SAIA | `0x09cb31401d8eb516794ce8ec01457c4815e3f2e0` | Mantle, X Layer, Ink |
| SAIL | `0xca8deaa2d80e6bfdb4581d34647ea73d9799c36d` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| SATA | `0x7c7445a40926152b8d24abdb9020e219d3d3380a` | X Layer |
| SBAC | `0xc26bc7f2fcc708d6678527672b65815ae83d8b05` | Mantle, X Layer, Ink |
| SBET | `0x338791c58fded314b81eab139a1a2fb7967d90d6` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| SBUX | `0x5667c2d45acb2933ce129b53615aaf17c69f262c` | X Layer, Ink |
| SCCO | `0x59fb22b2ee80d5630db4aebb80fac4a9a5fb778c` | Mantle, X Layer, Ink |
| SCHW | `0x0bf06f8ee1550352417df572ae66d821d3fdb8e5` | X Layer, Ink |
| SCI | `0x93132a761807f8dbd5d8c9b6d31f544d3deb8e1d` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| SEIC | `0x095aeda2e3a971ae4e283c557852cc1eee641547` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| SF | `0xb6ca5e1cdbe37d5b87ff92e424702a2af803a54a` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| SGI | `0xb5a30e0b5aa1def87c8c9ff28609cde3a3f88753` | Mantle, X Layer, Ink |
| SHAZ | `0x242d8409e549f8127ba6e85d7bad4a7ce57a4423` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| SHEIN | `0x4d0ba049c430a7a80a61e7ebdf50b6daac6c3bd6` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| SHW | `0xdff1d0b8570df76e4fc8efb87f3b6661159ac4d8` | X Layer, Ink |
| SINO | `0x6598634b4319841c72ac6ed9f868ed99ccf24fd9` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| SINOT | `0xef949d91e6a952e1cc1a57c0597abc72bef5fdf8` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| SITC | `0xa1a7cf1bbae3ec936dd4adbbcdcc6e799d663c7e` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| SJM | `0x72a639e1e2dfdaa828abf13c8f2ddb4bcf526eb0` | Mantle, X Layer, Ink |
| SKHY | `0x58100046a4afcd4ee4fadbd4244f3f895a341c56` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| SLV | `0x4833e7f4f0460f4b72a3a5879a6c9841bcc5b58b` | Arbitrum, HyperEVM, X Layer |
| SMCI | `0x39c31fc6038490ea4bf8a21ca18cd18f33b8d3fb` | Mantle, X Layer, Ink |
| SMH | `0x8d512a03600981b8e86556fd5c0fbdd726fe1821` | Mantle, X Layer, Ink |
| SMOIH | `0x4c599685e1b7717f245b93c9e081ed256d4781b3` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| SMTC | `0x860e267ee6db9d38256a46eabd56bf1f133ca4ae` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| SNA | `0xaf48e4c2b06bbb1605ab1d4277d21c7a3def15e6` | X Layer, Ink |
| SNBIO | `0xcf7cfed645f73ea1805711569be794dc04ed6236` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| SNDK | `0xb63efbc28860c8097e341de1fcf59456161e9d98` | Optimism, Mantle, X Layer, Ink |
| SNDSC | `0xf23685ea434474ba360aee965ebe8da450daaadf` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| SNOW | `0x18af2b532ac2d9fd18e9099a57fa3585f4bfa931` | X Layer, Ink |
| SNPS | `0x0d2566ead867f4883cbd14b5e1df4bca17b30c77` | X Layer, Ink |
| SNX | `0xde7367e2fd16a1b48e1db160104ada7b0f990171` | X Layer, Ink |
| SNXX | `0x868339e39489139f9cd27f279819886c1d352d1d` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| SO | `0x2e0fb57bf21cc5e32d3c72f7fdd4d0d23ca0f5f3` | X Layer, Ink |
| SOFI | `0xcf8e8e4d348502d5ab212ceaaa6062a6de1a53e2` | X Layer, Ink |
| SOLS | `0x180c8eb36138cdaa75d985d756005cd8344a042b` | Mantle, X Layer, Ink |
| SOXL | `0x53ee7f58cf031ea4d897fdfcdafad124b3160689` | X Layer |
| SOXS | `0x0782a5fae365eba67a6f6b688e415211c618f8d4` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| SOXX | `0x7b14968d19a6c051d6613716ea71f2dade46db9c` | X Layer |
| SPCX | `0x68fa48b1c2fe52b3d776e1953e0e782b5044ce28` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| SPG | `0x1528c70f4f826222f58348873c5f535bfede9b78` | X Layer, Ink |
| SPY | `0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| SRE | `0xa5b35b537cfa2bf7e14e5bb7b97b37db05e06c3b` | X Layer, Ink |
| SSNC | `0x93663705e383b3cd200607abd8fcf0a793a22738` | Mantle, X Layer, Ink |
| STLD | `0xf6cd1a8591109a9ba85c8c5d05f025230a0583eb` | X Layer, Ink |
| STRC | `0x1aad217b8f78dba5e6693460e8470f8b1a3977f3` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| STRK | `0x38e0445308e7fcd5230f2df6b52b36dd4ff313b6` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| STRL | `0xcdf976c44cb357977712c362407a823825e33e2a` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| STT | `0xd5c4e1e5db2b02d883e0aaffb6f66f4925bb9056` | X Layer, Ink |
| STZ | `0xedeacbee9c1f9c66d769c3e38a5f2b7a7d4b0420` | Mantle, X Layer, Ink |
| SUI | `0x89c87b91352e05c1a4dc917aa0790cede828c5c7` | Mantle, X Layer, Ink |
| SUOPT | `0x0e49293c80ca713503dc37890164c0f8009ed178` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| SWK | `0x741dbf66898cbcf7333b8304e3e107bf431e661d` | Mantle, X Layer, Ink |
| SWPRP | `0xab7371f7e002a77d40584b8c9f8615a081acbf31` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| SYF | `0xa5f97df7e8eceb65c4b0db66077d95035754a3e7` | X Layer, Ink |
| SYK | `0x43bfa15dfc86cdc64c3c54e0232a03ef3e0225b3` | X Layer, Ink |
| SYY | `0x27ff2d53a2d8bc9a28adfa24c9e05c2fd415b7e1` | X Layer, Ink |
| SZIGH | `0x5439cb47d04b4952c909fb880516979a9f0a2066` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| TBLL | `0x4cbf89ed7bb30b8a860fa86d3c96e9c72931299b` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| TCENT | `0xfa15e42c18cf57aeef4b1bac1cee7754af7cfe42` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| TDG | `0xb25199de75c08d844582c1fef7369e590cd60e94` | X Layer, Ink |
| TDY | `0x709635064d28bbabf37079f012529b8d239848c4` | X Layer, Ink |
| TE | `0x05f7ef3228b53ff9feb2dbb7617989c1ede6f7a8` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| TEAM | `0x592c21777443d7f857fb517c799abfb6c36e730f` | Mantle, X Layer, Ink |
| TFC | `0x8098c0b552d1f2e7f06e8f01106c7d631e5d98e9` | X Layer, Ink |
| THC | `0x27052f2459d0892112cd597735d885bfeec9dd88` | Mantle, X Layer, Ink |
| TJX | `0xcf1f5be54cfcf61a79a427c92835ac043266decd` | X Layer, Ink |
| TLN | `0xc5f341f934a35d5d086930586f2d75e1ed2939ff` | Mantle, X Layer, Ink |
| TMO | `0xaf072f109a2c173d822a4fe9af311a1b18f83d19` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| TMUS | `0x68f3ddee8bae33691e7cd0372984fd857e842760` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| TNGYI | `0x3a02c5276e33cda437e8e8e8b6473620125c9607` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| TOL | `0xd722acd6fd5006ef303107cb12d5930da1f41803` | Mantle, X Layer, Ink |
| TOST | `0x47ee09a9b5c7c98eb2768b91596bcaa2ba9dd2b8` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| TPL | `0x6c045bfd262bf5e5af067bb5280e044bcbb574fd` | X Layer, Ink |
| TPR | `0x433bffed4600cb94852647ef05e4a962c2474e04` | X Layer, Ink |
| TQQQ | `0xfdddb57878ef9d6f681ec4381dcb626b9e69ac86` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| TRGP | `0xc639a8265471dddcb2d51521fdfcfd395d00c55f` | X Layer, Ink |
| TRMB | `0x79e58e2f38dbd6ac8f8f41763b077ce80421737c` | Mantle, X Layer, Ink |
| TROW | `0xe7c7f0422ed5419608e7a95970d9d2462b591b65` | X Layer, Ink |
| TRU | `0x2bbe8c4f883cda87d86e158203a8160282781cd1` | Mantle, X Layer, Ink |
| TRV | `0xf7e82dd4b9556fd71735767a41672022445a760b` | X Layer, Ink |
| TSCO | `0x3216a28c44d87aa5006db1c4b13b422c7826df88` | Mantle, X Layer, Ink |
| TSLA | `0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| TSM | `0x9e3bf4ecfc44eedd624f26656b6736a3f093b073` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| TSN | `0xabd1dc87e0ddd489cd260d5455941e380391194f` | Mantle, X Layer, Ink |
| TTMI | `0xe1c691e2366c26ec357444daadde253fbed85d70` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| TTWO | `0x3234421fa54ddf0eb750ae04680cc0c4d2de2721` | X Layer, Ink |
| TW | `0xabc594305788dba7bb999d2998b9d15cb90737e2` | Mantle, X Layer, Ink |
| TWLO | `0xcde92f3b3ebab6c58cbbe18628033375ce0785f2` | Mantle, X Layer, Ink |
| TWST | `0x04ee5c38ceb66133f7ec01401a7673b6475e950d` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| TXN | `0xce6d41dca96b4ebe560721df729dbcba46a87ac7` | X Layer, Ink |
| TXRH | `0x013678d2039f27ac8531dd994411b6f6c502d889` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| TXT | `0xaff0e5f513cd797561ec8709e302de4e4da568e7` | Mantle, X Layer, Ink |
| TYL | `0x7e9d62b888f808182347eb734f3d1d252d595aa5` | Mantle, X Layer, Ink |
| U | `0x1a65a334918c39c00e5ad99ebe936c1bd681d95e` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| UAL | `0xdd9b0df2a2f17e16f7d5f9da87c0c03429c2437c` | X Layer, Ink |
| UBER | `0xdb9783ca04bbd64fe2c6d7b9503a979b3de30729` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| UDR | `0x75d1977456f92c423b5930ea2a1f3806aecf2cc7` | Mantle, X Layer, Ink |
| UHAL | `0xad987735fb5f2d7b26c7cfd3b34a2d19f4f3c8e0` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| UI | `0x17ebf5aef19876885f25a1531aa3b97c8cf75ffc` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| ULS | `0xf0a2bfea902fde8c3b83b017ceccde39d5428d34` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| ULTA | `0xf5d233a5727267b6b1a685e450a18f4dbc182efc` | X Layer, Ink |
| UNH | `0x167a6375da1efc4a5be0f470e73ecefd66245048` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| UNM | `0x7f599e426c11b810ea2bdd887a6b279b7ff45507` | Mantle, X Layer, Ink |
| UNP | `0x515b52734277509f1fa66adf671532428f18f4dd` | X Layer, Ink |
| UPS | `0xf19423dea91ace37fba0edd46a521be6330b791a` | Mantle, X Layer, Ink |
| URA | `0x0e6607ab45d2ca779068cd6d9426c409773969fd` | Mantle, X Layer, Ink |
| URI | `0x96d62c35816809a4e7575bbfe3f8587444b7b286` | X Layer, Ink |
| USAR | `0x6ee270d24b593f85863e95b6a7dd916a5957719f` | Mantle, X Layer, Ink |
| USB | `0xeff3b7e357eac03669cc75cceb148a5b3e28e7fd` | X Layer, Ink |
| USFD | `0x6e790c576444d788d33a57423368e080bd04a788` | X Layer, Ink |
| USPX | `0x368192fec58e3150600a1409c631c77f45745bec` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| UTHR | `0x3526cb34011b9bbc0ff5e60ee1dc9d04ea0cc09f` | X Layer, Ink |
| UUUU | `0xed579847e45b0c48cfd608da829073b2f7e65cf0` | Mantle, X Layer, Ink |
| V | `0x2363fd1235c1b6d3a5088ddf8df3a0b3a30c5293` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| VCX | `0xbac2588d2272ff6e5826e2882042fa2926039cba` | Mantle, X Layer, Ink |
| VEEV | `0x5f07e31067e20d6f192128bd3c4aae64a8ab01dd` | Mantle, X Layer, Ink |
| VGK | `0x9337a8f11f777cdaa310b5682b09b44ed8bdcbad` | Mantle, X Layer, Ink |
| VICI | `0xc7866e01c8a929b5dd5a1e67512b2d27faa4d121` | X Layer, Ink |
| VIDA | `0x44e49dde02c954cd9b67923af7b1070412e8f34e` | X Layer |
| VIK | `0x2029c6790263c5cbadc90a60d8fdb7f77ec86559` | Mantle, X Layer, Ink |
| VLO | `0x93ec0ebce4e49122e5b646a9c9da877ca1330a8c` | X Layer, Ink |
| VLTO | `0x2038669c36cd84ef022a5f9a4748556a334069f1` | Mantle, X Layer, Ink |
| VMC | `0xd77c9d0dc1c37a6cc8e9a8c2cba1ab44c39bdc65` | X Layer, Ink |
| VNOM | `0xf7d9260f004283c386ba5706ee035561560ffa97` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| VOO | `0xffae0b911cb2cb7b49fd75011d99d137c040a9ef` | X Layer |
| VRSK | `0x5774036ae3118d02756a44dce5058648ffa1059e` | X Layer, Ink |
| VRSN | `0x767761d9ed36e645f2f686b51ff851299bd942ff` | X Layer, Ink |
| VRTX | `0xc2451449a633dc7ff2020f30b5ba4887b7214eb6` | X Layer, Ink |
| VT | `0x6d5edeebbc6a4099eb8bb289eb3b80d799f7b28c` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| VTI | `0xbd730e618bcd88c82ddee52e10275cf2f88a4777` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| VTR | `0x9959a8191f52cb51c0d059c85fe5f6e4bb0cd6e0` | X Layer, Ink |
| VTRS | `0x2333814f24bdc4aef83d7e833ffdff2327bb2086` | X Layer, Ink |
| VUG | `0x6e0aafb414b620e096b9f7fe85625d3e5ce41d3f` | Mantle, X Layer, Ink |
| VZ | `0xf793cbc8e167b25050dd9543f5ae429095ad60f9` | X Layer, Ink |
| W | `0x142bf1f505fed39338897bc9f165a1dd505d9f55` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| WAB | `0xea67afca23af029936d819892611a7f2cf1c0710` | X Layer, Ink |
| WAT | `0x72b203cfdbcb3e54b03a98d854296b659d9c0776` | X Layer, Ink |
| WCC | `0x4ba21679bd21a09141cc1dcf53f2ae4be8cd3203` | X Layer, Ink |
| WDAY | `0x8537107b02089e42e6761774cef2264da2018768` | Mantle, X Layer, Ink |
| WDC | `0xd2e60293f29dde3815c16c664de722029e96e03a` | X Layer, Ink |
| WEC | `0xef9bd8f13ec8a9c8d251f42fceee75044476654d` | X Layer, Ink |
| WELL | `0x03aa4399fd8764e9f1a225dba90bbfdf5102b630` | X Layer, Ink |
| WEN | `0xfeee18422f8f1cd6193c12aafad7123dbff15517` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| WFC | `0xaab7f231396d7df9c51337a555fa07e3df02a42d` | X Layer, Ink |
| WGS | `0x5855b24ec03b9d0ae7d2ba0e4ba3fa90e13e4bc4` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| WHGRO | `0xcfcf754eb66751842a9794a487438ad4bf883fdd` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| WHRFR | `0x361bab925519badaaa405f0b1cb9d7797e7f3b1e` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| WM | `0x221bc716e3d7125ca6d8840ca9ac30d9ca3832d4` | X Layer, Ink |
| WMB | `0x8fda985c834cb85d0f964c683cf6281f84bea5f1` | X Layer, Ink |
| WMS | `0x81f87eaf62c1ac8e5e55c5c5e014e1b7d99fec1b` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| WMT | `0x7aefc9965699fbea943e03264d96e50cd4a97b21` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| WPC | `0x97de0627fb50bfc50c00ec14ff90f5c3a0ca3ca1` | Mantle, X Layer, Ink |
| WRB | `0xb8004fd562bdd80f515a9e9d439f7804041a9bd4` | Mantle, X Layer, Ink |
| WRFHD | `0x98fae910ab2959a6ca8cc2e9849bdb29371d0ce9` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| WRLD | `0x8777b4870ebdd0ba90eeb165ae154d1398eae1fd` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| WSM | `0x186a131049b945fe8ef62ddc245d60634c9c935c` | X Layer, Ink |
| WSO | `0xf9d8f6a1aa9d5620142e001c9b38ca8b360d3838` | Mantle, X Layer, Ink |
| WST | `0xaca636eba69011582eb6d2077436dd9bac27dcd8` | X Layer, Ink |
| WTRG | `0xad2fec6ba14a5b0b56f8ad7efdcaf3629a03ffa3` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| WTS | `0xe73ccffe6e8f07993c33b50dd4f118089f67a342` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| WUXIB | `0x00cafd59cdc7b742b0cd1fc326abb5d23bbaa966` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| WWD | `0xe61c8b12dac2fb289822fc4c1baaa36d285bc148` | X Layer, Ink |
| WXXDC | `0x2b507fb27f0626bfab890a5cfb6e2443f2eeb814` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| WY | `0xd49d9e668d5d4fb9153ef2c656c10a994d7d8c4b` | X Layer, Ink |
| WYFI | `0x9861604f392f025f69a7ff1f5c8044d0f15c8c35` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| XEL | `0xc5aea4a8ce7c9f679bb32033c35ebeb9cc2623c5` | X Layer, Ink |
| XIAO | `0xfb4f81f511b40b80996062032260a539e60adfc0` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| XLE | `0x6f75ac3b1b6fbe8bb5f948e25af03620f26ae838` | Mantle, X Layer, Ink |
| XOM | `0xeedb0273c5af792745180e9ff568cd01550ffa13` | Arbitrum, HyperEVM, Mantle, X Layer, Ink |
| XOP | `0x6b9cca56e783d1345785e4aa1188bbd673e911a2` | Mantle, X Layer, Ink |
| XPO | `0x0d28fa38c17a04b96f6356508874622053b9afd4` | X Layer, Ink |
| XRX | `0x19b7680118fd54b8d52ef922afb3bbb13e3ad47f` | Optimism, HyperEVM, Mantle, X Layer, Ink |
| XYL | `0x0ca6992ef0b684ea09d99dae60accfa4a9f794a9` | X Layer, Ink |
| XYZ | `0xae7267bda08c44f0422e3c85d0967c7a71f120df` | Mantle, X Layer, Ink |
| YLDE | `0xa96d03fe2479febc69535366933ea053d5acf9dd` | X Layer |
| YUM | `0xf946c949d70e6fb9245b708176e9060e05cffd30` | X Layer, Ink |
| ZBH | `0x004de17f31eec9b7f601b662f234c6e484da8f77` | X Layer, Ink |
| ZBRA | `0xee891968a2755ab5dd4c785a10beeb08b395811c` | Mantle, X Layer, Ink |
| ZHAOM | `0xb80bb881a830a48a21c567183fe7f90d7af9248c` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| ZJGLD | `0x4e2c81fba553e60238c2f568d82ad30e1774069a` | Arbitrum, Optimism, HyperEVM, Mantle, X Layer, Ink |
| ZM | `0x979ce3d15b845e7471a667338b7122e12ab66b52` | X Layer, Ink |
| ZS | `0xfbdb13eca3c94c538d79a1cc3f309966920fb85b` | Mantle, X Layer, Ink |
| ZTS | `0xe15f68fa7199200677e652eb7799b0521401a3e9` | Mantle, X Layer, Ink |

## 4. Perps margin

| Source | → Destination | Engine | Status |
|---|---|---|---|
| USDC Solana | Lighter Solana intent account (CCTP) | SPL transfer | live |
| USDC Solana | USDC Arbitrum @ Lighter intent address | Trustware, 1 Solana sig | live when LI.FI wins auction |
| USDC Solana | USDC Base @ Lighter intent address | Trustware | quoted, signable only to $10–50 |
| USDC Solana | Lighter UDA Solana address | SPL transfer | blocked, needs builder key |
| USDC Ethereum | USDC Arbitrum @ Lighter intent address | Trustware, ETH gas | live |
| USDC Base | USDC Arbitrum @ Lighter intent address | Trustware, Base ETH gas | live |
| USDC BNB (18 dp) | USDC Arbitrum @ Lighter intent address | Trustware, BNB gas | live |
| USDC Ethereum | Lighter L1 deposit contract | approve + deposit | registry |
| Lighter margin | USDC Ethereum @ embedded wallet | secure withdraw | built |
| USDC Solana | USDC Ethereum @ Ondo deposit address | Trustware, 1 Solana sig | quoted, execution gated |
| USDC Ethereum | USDC Ethereum @ Ondo deposit address | EVM route, ETH gas | built, gated |
| USDC Solana | USDC Arbitrum @ Ondo deposit address | Trustware | planned |
| SPYx Solana | SPYon Ethereum @ Ondo deposit address | Trustware | quoted, gated |
| QQQx Solana | QQQon Ethereum @ Ondo deposit address | Trustware | quoted, gated |
| SPCXx Solana | SPCXon Ethereum @ Ondo deposit address | Trustware | quoted (46–431 bps by size), gated |
| CRCLx Solana | CRCLon Ethereum @ Ondo deposit address | Trustware | registry |
| GLDx Solana | GLDon Ethereum @ Ondo deposit address | Trustware | registry, not 1:1 |
| any | SLVon Ethereum @ Ondo deposit address | Trustware | registry |
| any | SNDKon Ethereum @ Ondo deposit address | Trustware | blocked, ~50% loss |
| SPYon / QQQon held on Ethereum | Ondo deposit address | ERC-20 transfer, ETH gas | built, gated |
| Ondo margin | deposited asset on Ethereum @ payout address | Ondo executes, pays gas | built |
| SPCXon Ethereum | SPCXx Solana | Trustware unwind, ETH gas | quoted |
| SPYon / QQQon / CRCLon / GLDon Ethereum | matching xStock Solana | Trustware unwind | built |

## 5. USDC for vaults and wallet

| Source | → Destination | Engine | Status |
|---|---|---|---|
| USDC Solana | Jupiter Lend USDC vault / Kamino RWA USDC kvault | native deposit | live |
| SOL Solana | USDC Solana | Jupiter | live |
| USDC Solana | USDC Monad (Morpho vaults) | Trustware | live |
| USDC Solana | MON Monad (gas) | Trustware, zero-address sentinel | live |
| USDC Ethereum | USDC Monad | Trustware, ETH gas | built |
| USDC BNB | USDC Monad | Trustware, BNB gas | built |
| USDC Base | USDC Monad | Trustware, Base ETH gas | built |
| USDC Monad | USDC Solana | Trustware return | live |
| USDC Base | USDC Solana | Trustware return, ~$0.30 flat | live |
| USDC Ethereum | USDC Solana | Trustware return, ETH gas | built |
| USDC BNB | USDC Solana | Trustware return, BNB gas | built |
| USDC Arbitrum | USDC Solana | none | planned, chain not scanned or signable |
| USDC Ethereum / BNB / Base | USDC Solana → Jupiter Ultra buy | bridge then swap | built |

## 6. Gold

| Source | → Destination | Engine | Status |
|---|---|---|---|
| USDC Solana | XAUt Ethereum | Trustware, ~0.4% | live |
| USDC Solana | ETH Ethereum (gas), 0xEeee alias only | Trustware | live |
| GLDx / GLDon / XAUt0 Solana | USDC Solana | Jupiter, 0.3% | live |
| GLDx / GLDon / XAUt0 Solana | XAUt Ethereum direct | Trustware | blocked, 502 |
| GLDx / GLDon Ethereum or BNB | anything | Trustware | blocked, 502 |
| XAUt0 Solana | USDC Solana | Jupiter, 0.02% | live |
| PAXG Solana | USDC Solana | Jupiter Ultra | live |
| USDT Ethereum (borrowed) | USDC Solana | Trustware return, ~0.3% | live |
| USDC Solana | USDT Ethereum (repay) | Trustware swap | quoted |

## 7. Swap surface

Any pair, either direction, both sides in this set. Solana↔Solana via Jupiter, everything else via Trustware. All live as quotes.

| Chain | Tokens |
|---|---|
| Solana | USDC, USDT, SOL, ETH (Wormhole), WBTC (Wormhole), XAUt0 |
| Ethereum | USDC, USDT, ETH, WBTC, XAUt |
| BNB Chain | USDC (18 dp), USDT (18 dp), BNB, ETH, BTCB |

## 8. Other issuers

| Source | → Destination | Status |
|---|---|---|
| Dinari dShares Ethereum / Base | xStock Solana | planned; enumerate via factory `getDShares()` |
| Dinari dShares Arbitrum / Blast / Kinto / Plume | xStock Solana | planned; chain not signable |
| Backed bTokens (bNVDA, bCOIN) Ethereum / Base | xStock Solana | planned; product decision, bCSPX ≠ SPY |
| Robinhood stock tokens Arbitrum | xStock Solana | planned; chain not signable, transferability unconfirmed |
| Base-native tokenized stocks | xStock Solana | planned; issuer unknown |
